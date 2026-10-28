import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity as ActivityIcon, Award, CheckCircle2, ChevronRight, CircleHelp, Clipboard, Copy, Gift, History, KeyRound, LogOut, Plus, ShieldCheck, Sparkles, Trash2, Users, X } from 'lucide-react';
import { supabase, type Activity, type Completion, type UserProfile, cleanUsername } from './lib';

type Mode = 'login' | 'user' | 'admin';
type Toast = { kind: 'success' | 'error' | 'info'; text: string } | null;
type MultiplierEvent = { id?: string; factor: number; applied_at?: string };
type PointsBalance = { username: string; base_points: number; multiplier: number; redeemed_points: number; available_points: number };
type RedemptionResult = { username: string; points_before: number; points_deducted: number; points_after: number; redeemed_at: string };
const ADMIN_USERNAME = (import.meta.env.VITE_ADMIN_USERNAME || 'admin-feria').trim().toLowerCase(); // EDITAR AQUÍ el nombre reservado del administrador.
const demoActivities: Activity[] = [
  { id: 'demo-1', name: 'Visita el stand de innovación', description: 'Conoce una demostración y pregunta por una de las soluciones presentadas.', points: 20, password: 'INNOVA24', is_active: true },
  { id: 'demo-2', name: 'Participa en el reto', description: 'Completa el reto corto del equipo logístico.', points: 30, password: 'RETO2026', is_active: true },
  { id: 'demo-3', name: 'Escanea el punto de encuentro', description: 'Acércate al punto de información y solicita el código al encargado.', points: 10, password: 'PUNTO10', is_active: true },
];

function getSupabaseErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof e.message === 'string' ? e.message.trim() : '';
    const details = typeof e.details === 'string' ? e.details.trim() : '';
    const code = typeof e.code === 'string' ? e.code : '';
    if (message) return `${message}${code ? ` (código ${code})` : ''}${details ? ` — ${details}` : ''}`;
  }
  return error instanceof Error ? error.message : fallback;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [existingAccountModal, setExistingAccountModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [activities, setActivities] = useState<Activity[]>(() => {
    if (!supabase) { try { const saved = localStorage.getItem('feria-demo-activities'); if (saved) return JSON.parse(saved) as Activity[]; } catch { /* ignore invalid demo cache */ } }
    return demoActivities;
  });
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [redeemedPoints, setRedeemedPoints] = useState(0);
  const [redemptionUsername, setRedemptionUsername] = useState('');
  const [redemptionPoints, setRedemptionPoints] = useState('');
  const [redemptionDescription, setRedemptionDescription] = useState('');
  const [redemptionPreview, setRedemptionPreview] = useState<PointsBalance | null>(null);
  const [redemptionResult, setRedemptionResult] = useState<RedemptionResult | null>(null);
  const [multiplierEvents, setMultiplierEvents] = useState<MultiplierEvent[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [online] = useState(Boolean(supabase));
  const [activityModal, setActivityModal] = useState<Activity | null>(null);
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'activities' | 'manage' | 'multiplier' | 'redeem'>('activities');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activityName, setActivityName] = useState('');
  const [activityDescription, setActivityDescription] = useState('');
  const [activityPoints, setActivityPoints] = useState('20');
  const [activityPassword, setActivityPassword] = useState('');
  const [activityActive, setActivityActive] = useState(true);
  const [activityImage, setActivityImage] = useState<string | null>(null);
  const [multiplierUsername, setMultiplierUsername] = useState('');
  const [multiplierValue, setMultiplierValue] = useState('2');
  const [multiplierPreview, setMultiplierPreview] = useState<UserProfile | null>(null);
  const [multiplierResult, setMultiplierResult] = useState<number | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  const isAdmin = mode === 'admin';
  const completedIds = useMemo(() => new Set(completions.map(c => c.activity_id)), [completions]);
  const basePoints = useMemo(() => completions.reduce((sum, c) => sum + Number(c.points_awarded), 0), [completions]);
  const multiplier = currentUser?.multiplier ?? 1;
  const totalPoints = Math.max(0, Math.round(basePoints * multiplier) - redeemedPoints);

  useEffect(() => { if (toast) { const t = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(t); } }, [toast]);
  useEffect(() => { if (!supabase) localStorage.setItem('feria-demo-activities', JSON.stringify(activities)); }, [activities]);
  useEffect(() => {
    const client = supabase;
    if (!client || !currentUser) return;
    let alive = true;
    const load = async () => {
      const isAdminName = currentUser.username === ADMIN_USERNAME;
      const [actsResult, doneResult, profileResult, multiplierResult, redemptionResult] = await Promise.all([
        isAdminName
          ? client.rpc('admin_list_activities', { p_admin_username: currentUser.username })
          : client.from('activities').select('id, name, description, points, is_active, image_data, created_at').eq('is_deleted', false).order('created_at', { ascending: true }),
        isAdminName ? Promise.resolve({ data: [], error: null }) : client.rpc('get_user_completions', { p_username: currentUser.username }),
        isAdminName ? Promise.resolve({ data: currentUser, error: null }) : client.from('profiles').select('*').eq('id', currentUser.id).single(),
        isAdminName ? Promise.resolve({ data: [], error: null }) : client.rpc('get_user_multiplier_events', { p_username: currentUser.username }),
        isAdminName ? Promise.resolve({ data: [], error: null }) : client.rpc('get_user_redemption_total', { p_username: currentUser.username }),
      ]);
      if (!alive) return;
      if (actsResult.error || doneResult.error || profileResult.error || multiplierResult.error || redemptionResult.error) { setToast({ kind: 'error', text: 'No se pudieron cargar todos los datos. Revisa la configuración de Supabase y sus políticas.' }); return; }
      setActivities((actsResult.data ?? []) as Activity[]); setCompletions((doneResult.data ?? []) as Completion[]);
      setMultiplierEvents((multiplierResult.data ?? []) as MultiplierEvent[]);
      setRedeemedPoints(Number(redemptionResult.data ?? 0));
      if (profileResult.data) setCurrentUser(profileResult.data as UserProfile);
    };
    void load();
    const channel = client.channel('feria-live-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'completions', filter: `user_id=eq.${currentUser.id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${currentUser.id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'point_redemptions', filter: `user_id=eq.${currentUser.id}` }, () => void load())
      .subscribe();
    return () => { alive = false; void client.removeChannel(channel); };
  }, [currentUser?.id]);

  const notify = (text: string, kind: NonNullable<Toast>['kind'] = 'success') => setToast({ text, kind });

  async function enter(skipExistingCheck = false) {
    const normalized = cleanUsername(username);
    if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(normalized)) {
      notify('Usa entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.', 'error'); return;
    }
    if (!skipExistingCheck && normalized !== ADMIN_USERNAME) {
      try {
        let alreadyExists = false;
        if (supabase) {
          const { data, error } = await supabase.from('profiles').select('id').eq('username', normalized).maybeSingle();
          if (error) throw error;
          alreadyExists = Boolean(data?.id);
        } else {
          alreadyExists = Boolean(localStorage.getItem(`feria-demo-user:${normalized}`));
        }
        if (alreadyExists) { setExistingAccountModal(true); return; }
      } catch (e) {
        notify(getSupabaseErrorMessage(e, 'No se pudo comprobar si el usuario ya existe.'), 'error');
        return;
      }
    }
    setExistingAccountModal(false);
    setBusy(true);
    try {
      if (normalized === ADMIN_USERNAME) {
        // Demo gate only: this is not authentication. Secure deployments must verify admin identity server-side.
        setCurrentUser({ id: 'admin-session', username: normalized, multiplier: 1 }); setMode('admin'); setTab('activities');
        notify(supabase ? 'Panel administrativo abierto. El acceso por nombre no verifica identidad.' : 'Modo demostración: acceso administrativo no protegido.', 'info'); return;
      }
      if (!supabase) {
        const storageKey = `feria-demo-user:${normalized}`;
        const saved = localStorage.getItem(storageKey);
        const user = saved ? JSON.parse(saved) as UserProfile : { id: `demo-${normalized}`, username: normalized, multiplier: 1 };
        localStorage.setItem(storageKey, JSON.stringify(user));
        const done = localStorage.getItem(`feria-demo-completions:${normalized}`);
        setCompletions(done ? JSON.parse(done) as Completion[] : []);
        const events = localStorage.getItem(`feria-demo-multipliers:${normalized}`);
        setMultiplierEvents(events ? JSON.parse(events) as MultiplierEvent[] : []);
        setRedeemedPoints(Number(localStorage.getItem(`feria-demo-redemptions:${normalized}`) || 0));
        setCurrentUser(user); setMode('user');
        notify(saved ? 'Sesión iniciada.' : 'Registro creado. ¡Bienvenido a la feria!');
        return;
      }
      const { data, error } = await supabase.rpc('register_or_get_profile', { p_username: normalized });
      if (error) throw error;
      const profile = (Array.isArray(data) ? data[0] : data) as UserProfile;
      if (!profile?.id) throw new Error('No se pudo crear o recuperar el perfil.');
      setCurrentUser(profile); setMode('user');
      const { data: events, error: eventsError } = await supabase.rpc('get_user_multiplier_events', { p_username: normalized });
      if (eventsError) throw eventsError;
      setMultiplierEvents((events ?? []) as MultiplierEvent[]);
      const { data: redeemed, error: redeemedError } = await supabase.rpc('get_user_redemption_total', { p_username: normalized });
      if (redeemedError) throw redeemedError;
      setRedeemedPoints(Number(redeemed ?? 0));
      notify('Acceso correcto.');
    } catch (e) { notify(e instanceof Error ? e.message : 'No se pudo iniciar sesión.', 'error'); }
    finally { setBusy(false); }
  }

  function signOut() { setMode('login'); setCurrentUser(null); setCompletions([]); setMultiplierEvents([]); setRedeemedPoints(0); setActivityModal(null); setUsername(''); setTab('activities'); }

  async function completeActivity() {
    if (!currentUser || !activityModal) return;
    if (completedIds.has(activityModal.id)) { notify('Esta actividad ya aparece como completada.', 'error'); return; }
    if (!supabase && code.trim().toUpperCase() !== (activityModal.password ?? '').toUpperCase()) { notify('La contraseña no es correcta. Pide el código al encargado del local.', 'error'); return; }
    setBusy(true);
    try {
      if (supabase && !currentUser.id.startsWith('demo-')) {
        const { error } = await supabase.rpc('complete_activity', { p_username: currentUser.username, p_activity_id: activityModal.id, p_password: code.trim().toUpperCase() });
        if (error) throw error;
        const { data, error: readError } = await supabase.rpc('get_user_completions', { p_username: currentUser.username });
        if (readError) throw readError;
        setCompletions((data ?? []) as Completion[]);
      } else {
        const next = [...completions, { activity_id: activityModal.id, points_awarded: activityModal.points, completed_at: new Date().toISOString() }];
        setCompletions(next); localStorage.setItem(`feria-demo-completions:${currentUser.username}`, JSON.stringify(next));
      }
      notify(`Actividad completada: +${activityModal.points} puntos.`); setActivityModal(null); setCode('');
    } catch (e) { notify(e instanceof Error ? e.message : 'No fue posible registrar la actividad.', 'error'); }
    finally { setBusy(false); }
  }

  function resetActivityForm() { setEditingId(null); setActivityName(''); setActivityDescription(''); setActivityPoints('20'); setActivityPassword(''); setActivityActive(true); setActivityImage(null); const input = document.getElementById('activityImage') as HTMLInputElement | null; if (input) input.value = ''; }
  function editActivity(a: Activity) { setEditingId(a.id); setActivityName(a.name); setActivityDescription(a.description); setActivityPoints(String(a.points)); setActivityPassword(a.password ?? ''); setActivityActive(a.is_active); setActivityImage(a.image_data ?? null); setTab('manage'); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  async function saveActivity(e: FormEvent) {
    e.preventDefault();
    const points = Number(activityPoints);
    if (!activityName.trim() || !activityDescription.trim() || !activityPassword.trim() || !Number.isInteger(points) || points < 1 || points > 100000) { notify('Completa nombre, descripción, contraseña personalizada y un puntaje entero positivo.', 'error'); return; }
    setBusy(true);
    try {
      if (supabase) {
        if (editingId) {
          const { error } = await supabase.rpc('admin_update_activity', { p_admin_username: currentUser?.username, p_activity_id: editingId, p_name: activityName.trim(), p_description: activityDescription.trim(), p_points: points, p_is_active: activityActive, p_image_data: activityImage, p_password: activityPassword.trim().toUpperCase() });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc('admin_create_activity', { p_admin_username: currentUser?.username, p_name: activityName.trim(), p_description: activityDescription.trim(), p_points: points, p_password: activityPassword.trim().toUpperCase(), p_image_data: activityImage });
          if (error) throw error;
        }
        const { data, error } = await supabase.rpc('admin_list_activities', { p_admin_username: currentUser?.username });
        if (error) throw error; setActivities((data ?? []) as Activity[]);
      } else if (editingId) {
        setActivities(prev => prev.map(a => a.id === editingId ? { ...a, name: activityName.trim(), description: activityDescription.trim(), points, password: activityPassword.trim().toUpperCase(), is_active: activityActive, image_data: activityImage } : a));
      } else {
        setActivities(prev => [...prev, { id: crypto.randomUUID(), name: activityName.trim(), description: activityDescription.trim(), points, password: activityPassword.trim().toUpperCase(), is_active: true, image_data: activityImage }]);
      }
      notify(editingId ? 'Actividad actualizada.' : 'Actividad creada con contraseña personalizada.'); resetActivityForm(); setTab('activities');
    } catch (e) { notify(e instanceof Error ? e.message : 'No se pudo guardar la actividad.', 'error'); }
    finally { setBusy(false); }
  }

  async function toggleActivity(a: Activity) {
    const nextState = !a.is_active;
    try {
      if (supabase) {
        const { error } = await supabase.rpc('admin_update_activity', { p_admin_username: currentUser?.username, p_activity_id: a.id, p_name: a.name, p_description: a.description, p_points: a.points, p_is_active: nextState, p_image_data: a.image_data ?? null });
        if (error) throw error;
      }
      setActivities(prev => prev.map(item => item.id === a.id ? { ...item, is_active: nextState } : item));
      notify(nextState ? 'Actividad activada.' : 'Actividad desactivada.');
    } catch (e) { notify(e instanceof Error ? e.message : 'No se pudo actualizar.', 'error'); }
  }

  async function deleteActivity(a: Activity) {
    const confirmed = window.confirm(`¿Eliminar “${a.name}” de la feria?\n\nLa actividad dejará de aparecer a los participantes. Los cumplimientos y puntos ya registrados se conservarán en el historial.`);
    if (!confirmed) return;
    setBusy(true);
    try {
      if (supabase) {
        const { error } = await supabase.rpc('admin_delete_activity', {
          p_admin_username: currentUser?.username,
          p_activity_id: a.id,
        });
        if (error) throw error;
        const { data, error: listError } = await supabase.rpc('admin_list_activities', { p_admin_username: currentUser?.username });
        if (listError) throw listError;
        setActivities((data ?? []) as Activity[]);
      } else {
        setActivities(prev => prev.filter(item => item.id !== a.id));
        const saved = localStorage.getItem('feria-demo-activities');
        if (saved) {
          try { localStorage.setItem('feria-demo-activities', JSON.stringify((JSON.parse(saved) as Activity[]).filter(item => item.id !== a.id))); } catch { /* ignore invalid demo cache */ }
        }
      }
      if (editingId === a.id) resetActivityForm();
      notify('Actividad retirada de la feria. El historial y los puntos se conservaron.');
    } catch (e) {
      notify(getSupabaseErrorMessage(e, 'No se pudo retirar la actividad de la feria.'), 'error');
    } finally { setBusy(false); }
  }

  async function lookupMultiplier() {
    const normalized = cleanUsername(multiplierUsername);
    if (!normalized) { notify('Escribe el nombre del usuario.', 'error'); return; }
    try {
      let profile: UserProfile | null = null;
      if (supabase) {
        const { data, error } = await supabase.rpc('admin_list_profiles', { p_admin_username: currentUser?.username });
        if (error) throw error;
        profile = ((data ?? []) as UserProfile[]).find(u => u.username === normalized) ?? null;
      } else {
        profile = allUsers.find(u => u.username === normalized) ?? (localStorage.getItem(`feria-demo-user:${normalized}`) ? JSON.parse(localStorage.getItem(`feria-demo-user:${normalized}`)!) as UserProfile : null);
      }
      setMultiplierPreview(profile); setMultiplierResult(null);
      if (!profile) notify('No se encontró ese usuario.', 'error');
    } catch (e) { notify(e instanceof Error ? e.message : 'No se pudo buscar el usuario.', 'error'); }
  }

  async function applyMultiplier() {
    if (!multiplierPreview) return;
    const value = Number(multiplierValue);
    if (!Number.isFinite(value) || value < 1 || value > 10) { notify('El multiplicador debe estar entre ×1 y ×10.', 'error'); return; }
    try {
      if (supabase) {
        const { error } = await supabase.rpc('admin_set_multiplier', { p_admin_username: currentUser?.username, p_username: multiplierPreview.username, p_multiplier: value });
        if (error) throw error;
      } else {
        const cumulative = Number((multiplierPreview.multiplier * value).toFixed(4));
        const next = { ...multiplierPreview, multiplier: cumulative };
        const events = JSON.parse(localStorage.getItem(`feria-demo-multipliers:${next.username}`) || '[]') as MultiplierEvent[];
        events.push({ factor: value, applied_at: new Date().toISOString() });
        localStorage.setItem(`feria-demo-multipliers:${next.username}`, JSON.stringify(events));
        localStorage.setItem(`feria-demo-user:${next.username}`, JSON.stringify(next));
        setAllUsers(prev => [...prev.filter(u => u.username !== next.username), next]);
        if (currentUser?.username === next.username) { setCurrentUser(next); setMultiplierEvents(events); }
        setMultiplierPreview(next);
      }
      if (supabase) {
        const { data, error } = await supabase.rpc('admin_list_profiles', { p_admin_username: currentUser?.username });
        if (error) throw error;
        const refreshed = ((data ?? []) as UserProfile[]).find(u => u.username === multiplierPreview.username);
        if (refreshed) setMultiplierPreview(refreshed);
      }
      setMultiplierResult(value); notify(`Multiplicador adicional ×${value} aplicado a ${multiplierPreview.username}.`);
    } catch (e) { notify(e instanceof Error ? e.message : 'No se pudo aplicar el multiplicador.', 'error'); }
  }

  async function lookupRedemptionBalance() {
    const normalized = cleanUsername(redemptionUsername);
    if (!normalized) { notify('Escribe el nombre del usuario.', 'error'); return; }
    try {
      if (!supabase) {
        const user = localStorage.getItem(`feria-demo-user:${normalized}`);
        if (!user) { setRedemptionPreview(null); notify('No se encontró ese usuario.', 'error'); return; }
        const profile = JSON.parse(user) as UserProfile;
        const done = JSON.parse(localStorage.getItem(`feria-demo-completions:${normalized}`) || '[]') as Completion[];
        const base = done.reduce((sum, c) => sum + Number(c.points_awarded), 0);
        const redeemed = Number(localStorage.getItem(`feria-demo-redemptions:${normalized}`) || 0);
        setRedemptionPreview({ username: normalized, base_points: base, multiplier: profile.multiplier ?? 1, redeemed_points: redeemed, available_points: Math.max(0, Math.round(base * (profile.multiplier ?? 1)) - redeemed) });
        setRedemptionResult(null);
        return;
      }
      const { data, error } = await supabase.rpc('admin_get_points_balance', { p_admin_username: currentUser?.username, p_username: normalized });
      if (error) throw error;
      const balance = (Array.isArray(data) ? data[0] : data) as PointsBalance | undefined;
      setRedemptionPreview(balance ?? null);
      setRedemptionResult(null);
      if (!balance) notify('No se encontró ese usuario.', 'error');
    } catch (e) { notify(getSupabaseErrorMessage(e, 'No se pudo consultar el saldo del participante.'), 'error'); }
  }

  async function redeemPoints() {
    if (!redemptionPreview) return;
    const points = Number(redemptionPoints);
    if (!Number.isInteger(points) || points <= 0) { notify('Ingresa una cantidad entera de puntos mayor que cero.', 'error'); return; }
    if (points > redemptionPreview.available_points) { notify('El descuento no puede superar los puntos disponibles.', 'error'); return; }
    const reward = redemptionDescription.trim() || 'Canje de premio';
    const confirmed = window.confirm(`Confirmar canje para ${redemptionPreview.username}?\\n\\nPremio: ${reward}\\nPuntos a descontar: ${points}\\nSaldo restante: ${redemptionPreview.available_points - points}`);
    if (!confirmed) return;
    setBusy(true);
    try {
      if (supabase) {
        const { data, error } = await supabase.rpc('admin_redeem_points', {
          p_admin_username: currentUser?.username,
          p_username: redemptionPreview.username,
          p_points: points,
          p_reward_description: reward,
        });
        if (error) throw error;
        const result = (Array.isArray(data) ? data[0] : data) as RedemptionResult;
        setRedemptionResult(result);
        const { data: refreshed, error: refreshError } = await supabase.rpc('admin_get_points_balance', { p_admin_username: currentUser?.username, p_username: redemptionPreview.username });
        if (refreshError) throw refreshError;
        const balance = (Array.isArray(refreshed) ? refreshed[0] : refreshed) as PointsBalance | undefined;
        setRedemptionPreview(balance ?? null);
      } else {
        const user = JSON.parse(localStorage.getItem(`feria-demo-user:${redemptionPreview.username}`) || '{}') as UserProfile;
        const done = JSON.parse(localStorage.getItem(`feria-demo-completions:${redemptionPreview.username}`) || '[]') as Completion[];
        const base = done.reduce((sum, c) => sum + Number(c.points_awarded), 0);
        const before = Math.max(0, Math.round(base * (user.multiplier ?? 1)) - redemptionPreview.redeemed_points);
        if (points > before) throw new Error('El descuento supera los puntos disponibles.');
        const redeemed = redemptionPreview.redeemed_points + points;
        localStorage.setItem(`feria-demo-redemptions:${redemptionPreview.username}`, String(redeemed));
        const result = { username: redemptionPreview.username, points_before: before, points_deducted: points, points_after: before - points, redeemed_at: new Date().toISOString() };
        setRedemptionResult(result);
        setRedemptionPreview({ ...redemptionPreview, redeemed_points: redeemed, available_points: before - points });
      }
      notify(`Canje registrado: se descontaron ${points} puntos a ${redemptionPreview.username}.`);
      setRedemptionPoints('');
      setRedemptionDescription('');
    } catch (e) { notify(getSupabaseErrorMessage(e, 'No se pudo registrar el canje.'), 'error'); }
    finally { setBusy(false); }
  }

  async function refreshAdminData() {
    if (!supabase) { notify('En modo demostración, los usuarios solo existen en este navegador.', 'info'); return; }
    const { data, error } = await supabase.rpc('admin_list_profiles', { p_admin_username: currentUser?.username });
    if (error) notify(error.message, 'error'); else setAllUsers((data ?? []) as UserProfile[]);
  }

  const displayedActivities = activities.filter(a => isAdmin || a.is_active);
  const activeCount = activities.filter(a => a.is_active).length;

  if (mode === 'login') return <div className="login-shell">
    <div className="login-decoration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="decoration-dot dot-one"/><div className="decoration-dot dot-two"/><div className="login-partner-logos"><img src="/wwf-logo.png" alt="WWF" className="wwf-large-logo"/><span className="partner-plus">+</span><img src="/cas-logo.jpg" alt="CAS" className="cas-large-logo"/></div></div>
    <main className="login-card">
      <div className="brand-lockup login-brand-lockup"><img src="/wwf-logo.png" alt="WWF" className="brand-partner-logo wwf-brand-logo"/><img src="/cas-logo.jpg" alt="CAS" className="brand-partner-logo cas-brand-logo"/><div className="brand-wording"><div className="brand-name">WWF Juntos por la vida</div><div className="brand-caption">EXPERIENCIA · RETOS · PUNTOS</div></div></div>
      <div className="login-copy"><div className="eyebrow">JUNTOS POR LA VIDA</div><h1>Todo lo que haces<br/><span>suma puntos.</span></h1><p>Ingresa con tu nombre de usuario y empieza a completar actividades y sumar puntos.</p></div>
      <form className="login-form" onSubmit={e => { e.preventDefault(); void enter(); }}>
        <label htmlFor="username">Nombre de usuario</label><div className="input-with-icon"><Users size={18}/><input id="username" autoComplete="username" autoFocus value={username} onChange={e => setUsername(e.target.value)} placeholder="Ingresa tu usuario de Epik" maxLength={30}/></div>
        <div className="helper-text"><ShieldCheck size={14}/> Sin contraseña. Tu usuario debe ser único.</div>
        <button className="button button-primary button-wide" disabled={busy || !username.trim()}>{busy ? 'Ingresando…' : 'Entrar'}<ChevronRight size={18}/></button>
      </form>
      <div className="login-footer"><span className={`status-dot ${online ? 'is-online' : ''}`}/>{online ? 'Conectado a la base de datos' : 'Modo de demostración'}<span className="footer-separator">·</span><span>Acceso de participantes</span></div>
      {!online && <div className="demo-notice"><CircleHelp size={15}/> Vista de demostración: los datos se guardan en este navegador. Configura Supabase para compartirlos entre dispositivos.</div>}
    </main>
    {existingAccountModal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setExistingAccountModal(false); }}><section className="modal-card existing-account-dialog" role="dialog" aria-modal="true" aria-labelledby="existing-account-title"><div className="modal-symbol"><Users size={24}/></div><div className="eyebrow">CUENTA EXISTENTE</div><h2 id="existing-account-title">Este usuario ya está registrado</h2><p className="modal-description">La cuenta <strong>{cleanUsername(username)}</strong> ya existe. Puedes entrar a esa cuenta para recuperar sus puntos e historial, o cambiar el nombre para registrar una cuenta nueva.</p><button className="button button-primary button-wide" onClick={() => { setExistingAccountModal(false); void enter(true); }}>Entrar a esta cuenta <ChevronRight size={17}/></button><button className="button button-light button-wide" onClick={() => { setExistingAccountModal(false); setUsername(''); window.setTimeout(() => document.getElementById('username')?.focus(), 0); }}>Cambiar nombre de usuario</button></section></div>}
    {toast && <ToastView toast={toast}/>}<div className="login-bottom">UNA EXPERIENCIA QUE SE JUEGA PUNTO A PUNTO</div>
  </div>;

  return <div className="app-shell">
    <header className="topbar"><div className="topbar-inner"><button className="brand-lockup brand-button" onClick={() => setTab('activities')}><img src="/wwf-logo.png" alt="WWF" className="brand-partner-logo wwf-brand-logo"/><img src="/cas-logo.jpg" alt="CAS" className="brand-partner-logo cas-brand-logo"/><div className="brand-wording"><div className="brand-name">WWF Juntos por la vida</div><div className="brand-caption">PUNTOS Y ACTIVIDADES</div></div></button><div className="topbar-right"><div className="connection-chip"><span className={`status-dot ${online ? 'is-online' : ''}`}/>{online ? 'En línea' : 'Demo'}</div><button className="user-chip" onClick={signOut} title="Cerrar sesión"><span className="avatar">{currentUser?.username.slice(0, 1).toUpperCase()}</span><span className="user-chip-name">{currentUser?.username}</span><LogOut size={16}/></button></div></div></header>
    <main className="page-wrap">
      <section className="profile-banner"><div className="profile-left"><div className="profile-avatar">{isAdmin ? <ShieldCheck size={25}/> : currentUser?.username.slice(0, 1).toUpperCase()}</div><div className="profile-info"><div className="profile-eyebrow">{isAdmin ? 'PANEL DE CONTROL' : 'TU PERFIL'}</div><h1>{currentUser?.username}</h1><div className="profile-subtitle">{isAdmin ? 'Administra actividades y puntuaciones' : '¡Sigue participando para sumar más!'}</div></div></div><div className="points-block"><div className="points-label"><Award size={16}/> {isAdmin ? 'ACTIVIDADES ACTIVAS' : 'PUNTOS ACUMULADOS'}</div><div className="points-number">{isAdmin ? activeCount : totalPoints.toLocaleString('es-CO')}<span>{isAdmin ? 'activas' : 'pts'}</span></div>{!isAdmin && <div className="points-footnote">Base: {basePoints.toLocaleString('es-CO')} pts</div>}{!isAdmin && redeemedPoints > 0 && <div className="points-footnote">Canjeados: {redeemedPoints.toLocaleString('es-CO')} pts</div>}{!isAdmin && multiplierEvents.length > 0 && <div className="multiplier-result"><span>Multiplicadores: {multiplierEvents.map(e => `×${Number(e.factor).toLocaleString('es-CO')}`).join(' · ')}</span></div>}</div></section>
      {isAdmin && <nav className="admin-tabs"><button className={tab === 'activities' ? 'tab active' : 'tab'} onClick={() => setTab('activities')}><ActivityIcon size={17}/> Actividades y códigos</button><button className={tab === 'manage' ? 'tab active' : 'tab'} onClick={() => { setTab('manage'); if (!editingId) resetActivityForm(); }}><Plus size={17}/> {editingId ? 'Editar actividad' : 'Crear actividad'}</button><button className={tab === 'multiplier' ? 'tab active' : 'tab'} onClick={() => { setTab('multiplier'); void refreshAdminData(); }}><Sparkles size={17}/> Multiplicadores</button><button className={tab === 'redeem' ? 'tab active' : 'tab'} onClick={() => { setTab('redeem'); setRedemptionPreview(null); setRedemptionResult(null); }}><Gift size={17}/> Canje de premios</button></nav>}

      {(!isAdmin || tab === 'activities') && <>
        <section className="section-heading"><div><div className="eyebrow">{isAdmin ? 'GESTIÓN DE ACTIVIDADES' : 'DESCUBRE · PARTICIPA · GANA'}</div><h2>{isAdmin ? 'Actividades y contraseñas' : 'Actividades disponibles'}</h2><p>{isAdmin ? 'Comparte el código con los participantes cuando hayan cumplido los requisitos.' : 'Completa las actividades y pide el código al encargado de cada local.'}</p></div><div className="activity-count"><span>{displayedActivities.filter(a => isAdmin || !completedIds.has(a.id)).length}</span><span>{isAdmin ? 'actividades' : 'por completar'}</span></div></section>
        {displayedActivities.length === 0 ? <EmptyState title="Todavía no hay actividades" text="Cuando se creen actividades, aparecerán aquí."/> : <div className="activity-grid">{displayedActivities.map((a, i) => {
          const done = completedIds.has(a.id);
          return <article className={`activity-card ${done ? 'is-complete' : ''} ${!a.is_active ? 'is-inactive' : ''}`} key={a.id}>
            <div className="activity-card-top"><div className={`activity-icon activity-icon-${i % 4}`}>{a.image_data ? <img className="activity-logo" src={a.image_data} alt={`Logo de ${a.name}`} /> : done ? <CheckCircle2 size={23}/> : <ActivityIcon size={23}/>}</div><div className="activity-points">+{a.points}<span> pts</span></div></div>
            <div className="activity-card-content"><div className="activity-kicker">ACTIVIDAD {String(i + 1).padStart(2, '0')}{!a.is_active && <span className="inactive-tag">INACTIVA</span>}</div><h3>{a.name}</h3><p>{a.description}</p></div>
            {isAdmin ? <div className="admin-code-box"><div><span className="code-label"><KeyRound size={14}/> CONTRASEÑA DEL LOCAL</span><code>{a.password}</code></div><button className="icon-button" onClick={() => { void navigator.clipboard?.writeText(a.password ?? ''); notify('Contraseña copiada.'); }} aria-label="Copiar contraseña"><Copy size={17}/></button></div> : <div className="activity-card-bottom">{done ? <div className="completed-state"><CheckCircle2 size={17}/> Actividad completada</div> : <button className="button button-dark button-wide" disabled={!a.is_active} onClick={() => { setActivityModal(a); setCode(''); }}>Marcar como cumplida <ChevronRight size={17}/></button>}</div>}
            {isAdmin && <div className="admin-card-actions"><button className="text-button" onClick={() => editActivity(a)}>Editar actividad</button><button className="text-button" onClick={() => void toggleActivity(a)}>{a.is_active ? 'Desactivar' : 'Activar'}</button><button className="text-button delete-activity-button" disabled={busy} onClick={() => void deleteActivity(a)}><Trash2 size={13}/> Eliminar</button></div>}
          </article>;
        })}</div>}
        {!isAdmin && <div className="how-it-works"><div className="how-icon"><KeyRound size={20}/></div><div><strong>¿Ya cumpliste una actividad?</strong><p>Pide la contraseña al encargado del local. Es la única forma de validar tu participación y recibir tus puntos.</p></div></div>}
      </>}

      {isAdmin && tab === 'manage' && <section className="admin-panel"><div className="panel-heading"><div className="panel-icon"><Plus size={21}/></div><div><h2>{editingId ? 'Editar actividad' : 'Crear nueva actividad'}</h2><p>{editingId ? 'Actualiza los datos de esta actividad.' : 'Define la contraseña que compartirás con el encargado de la actividad.'}</p></div></div><form className="admin-form" onSubmit={e => void saveActivity(e)}><div className="form-field"><label htmlFor="activityName">Nombre de la actividad</label><input id="activityName" value={activityName} onChange={e => setActivityName(e.target.value)} placeholder="Ej. Visita el stand de tecnología" required maxLength={90}/></div><div className="form-field"><label htmlFor="activityDescription">Descripción y requisitos</label><textarea id="activityDescription" value={activityDescription} onChange={e => setActivityDescription(e.target.value)} placeholder="Explica qué debe hacer el participante…" rows={4} required maxLength={500}/></div><div className="form-field"><label htmlFor="activityPassword">Contraseña personalizada</label><input id="activityPassword" value={activityPassword} onChange={e => setActivityPassword(e.target.value.toUpperCase().replace(/\s/g, ''))} placeholder="Ej. WWFVIDA26" required maxLength={32} autoComplete="off"/><span className="field-hint">Define el código que el encargado entregará al participante. Usa un código único y fácil de comunicar.</span></div><div className="form-field"><label htmlFor="activityImage">Logo o imagen (opcional)</label><input id="activityImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 400 * 1024) { notify('La imagen debe pesar máximo 400 KB.', 'error'); e.target.value = ''; return; } if (!file.type.startsWith('image/')) { notify('Selecciona un archivo de imagen.', 'error'); e.target.value = ''; return; } const reader = new FileReader(); reader.onload = () => setActivityImage(String(reader.result)); reader.onerror = () => notify('No se pudo leer la imagen.', 'error'); reader.readAsDataURL(file); }}/><span className="field-hint">PNG, JPG, WEBP, GIF o SVG. Máximo 400 KB. La imagen aparecerá junto al nombre de la actividad.</span>{activityImage && <div className="image-preview-row"><img src={activityImage} alt="Vista previa del logo"/><button type="button" className="text-button delete-activity-button" onClick={() => { setActivityImage(null); const input = document.getElementById('activityImage') as HTMLInputElement | null; if (input) input.value = ''; }}>Quitar imagen</button></div>}</div><div className="form-field form-field-short"><label htmlFor="activityPoints">Puntaje fijo</label><div className="number-input-wrap"><input id="activityPoints" type="number" min="1" max="100000" step="1" value={activityPoints} onChange={e => setActivityPoints(e.target.value)} required/><span>puntos</span></div><span className="field-hint">El puntaje se asigna una sola vez por participante.</span></div>{editingId && <label className="toggle-row"><input type="checkbox" checked={activityActive} onChange={e => setActivityActive(e.target.checked)}/><span><strong>Actividad activa</strong><small>Si la desactivas, dejará de aparecer a los participantes.</small></span></label>}<div className="form-actions">{editingId && <button type="button" className="button button-light" onClick={resetActivityForm}>Cancelar edición</button>}<button className="button button-primary" disabled={busy}>{busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear actividad'}<ChevronRight size={17}/></button></div></form></section>}

      {isAdmin && tab === 'multiplier' && <section className="admin-panel multiplier-panel"><div className="panel-heading"><div className="panel-icon purple"><Sparkles size={21}/></div><div><h2>Multiplicador de puntos</h2><p>Aplica un multiplicador adicional al total actual. Cada aplicación se acumula con las anteriores.</p></div></div><div className="multiplier-explainer"><div className="math-example"><span>Puntos base</span><strong>100</strong></div><span className="math-symbol">×</span><div className="math-example"><span>Factor adicional</span><strong className="purple-text">2×</strong></div><span className="math-symbol">=</span><div className="math-example result-example"><span>Total resultante</span><strong>200</strong></div></div><form className="admin-form" onSubmit={e => { e.preventDefault(); void lookupMultiplier(); }}><div className="form-field"><label htmlFor="multiplierUsername">Nombre de usuario del participante</label><div className="input-action-row"><input id="multiplierUsername" value={multiplierUsername} onChange={e => { setMultiplierUsername(e.target.value); setMultiplierPreview(null); setMultiplierResult(null); }} placeholder="Ej. isabella.m" required/><button className="button button-dark" type="submit">Buscar usuario</button></div></div></form>{multiplierPreview && <div className="user-found-card"><div className="found-user"><div className="avatar avatar-large">{multiplierPreview.username.slice(0, 1).toUpperCase()}</div><div><strong>{multiplierPreview.username}</strong><span>Multiplicador acumulado actual: ×{Number(multiplierPreview.multiplier).toLocaleString('es-CO')}</span></div></div><div className="form-field"><label htmlFor="multiplierValue">Multiplicador adicional</label><select id="multiplierValue" value={multiplierValue} onChange={e => setMultiplierValue(e.target.value)}><option value="1">×1 — Sin cambio adicional</option><option value="1.5">×1,5</option><option value="2">×2 — Doble puntaje</option><option value="3">×3 — Triple puntaje</option><option value="4">×4</option><option value="5">×5</option><option value="10">×10</option></select></div><button className="button button-primary button-wide" onClick={() => void applyMultiplier()}>Aplicar multiplicador <Sparkles size={17}/></button>{multiplierResult !== null && <p className="success-note"><CheckCircle2 size={16}/> Multiplicador ×{multiplierResult} aplicado a {multiplierPreview.username}.</p>}</div>}<div className="admin-warning"><ShieldCheck size={17}/><p>Cada factor se multiplica por el acumulado anterior. Se conserva el puntaje base y el historial de cada multiplicador aplicado.</p></div></section>}

      {isAdmin && tab === 'redeem' && <section className="admin-panel multiplier-panel"><div className="panel-heading"><div className="panel-icon"><Gift size={21}/></div><div><h2>Canje de premios</h2><p>Descuenta los puntos que un participante utiliza para reclamar un premio. Cada canje queda registrado en el historial.</p></div></div><form className="admin-form" onSubmit={e => { e.preventDefault(); void lookupRedemptionBalance(); }}><div className="form-field"><label htmlFor="redemptionUsername">Nombre de usuario del participante</label><div className="input-action-row"><input id="redemptionUsername" value={redemptionUsername} onChange={e => { setRedemptionUsername(e.target.value); setRedemptionPreview(null); setRedemptionResult(null); }} placeholder="Ej. isabella.m" required/><button className="button button-dark" type="submit" disabled={busy}>Consultar saldo</button></div></div></form>{redemptionPreview && <div className="user-found-card"><div className="found-user"><div className="avatar avatar-large">{redemptionPreview.username.slice(0, 1).toUpperCase()}</div><div><strong>{redemptionPreview.username}</strong><span>Multiplicador acumulado: ×{Number(redemptionPreview.multiplier).toLocaleString('es-CO')}</span></div></div><div className="multiplier-explainer"><div className="math-example"><span>Puntos base</span><strong>{Number(redemptionPreview.base_points).toLocaleString('es-CO')}</strong></div><span className="math-symbol">−</span><div className="math-example"><span>Ya canjeados</span><strong>{Number(redemptionPreview.redeemed_points).toLocaleString('es-CO')}</strong></div><span className="math-symbol">=</span><div className="math-example result-example"><span>Disponibles</span><strong>{Number(redemptionPreview.available_points).toLocaleString('es-CO')}</strong></div></div><div className="form-field"><label htmlFor="redemptionDescription">Premio entregado (opcional)</label><input id="redemptionDescription" value={redemptionDescription} onChange={e => setRedemptionDescription(e.target.value)} placeholder="Ej. Bono de alimentación" maxLength={120}/></div><div className="form-field"><label htmlFor="redemptionPoints">Puntos que se descontarán</label><input id="redemptionPoints" type="number" min="1" max={redemptionPreview.available_points} step="1" value={redemptionPoints} onChange={e => setRedemptionPoints(e.target.value)} placeholder="Ej. 300" required/><span className="field-hint">No puedes descontar más puntos de los que están disponibles.</span></div><button className="button button-primary button-wide" disabled={busy || !redemptionPoints || Number(redemptionPoints) > redemptionPreview.available_points} onClick={() => void redeemPoints()}>{busy ? 'Registrando canje…' : 'Confirmar canje y descontar puntos'}<Gift size={17}/></button>{redemptionResult && <p className="success-note"><CheckCircle2 size={16}/> Canje registrado para {redemptionResult.username}: −{Number(redemptionResult.points_deducted).toLocaleString('es-CO')} puntos. Saldo restante: {Number(redemptionResult.points_after).toLocaleString('es-CO')} puntos.</p>}</div>}<div className="admin-warning"><History size={17}/><p>Los canjes se guardan como movimientos independientes. No se eliminan las actividades completadas ni el historial de puntos originales.</p></div></section>}

      <footer className="app-footer"><span>WWF JUNTOS POR LA VIDA · SISTEMA DE PUNTOS</span><span>Participa. Descubre. Suma.</span></footer>
    </main>
    {activityModal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setActivityModal(null); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={() => setActivityModal(null)} aria-label="Cerrar"><X size={19}/></button><div className="modal-symbol"><KeyRound size={25}/></div><div className="eyebrow">VALIDAR PARTICIPACIÓN</div><h2 id="modal-title">{activityModal.name}</h2><p className="modal-description">{activityModal.description}</p><div className="modal-points">Al validar esta actividad recibirás <strong>+{activityModal.points} puntos</strong>.</div><form onSubmit={e => { e.preventDefault(); void completeActivity(); }}><label htmlFor="activityCode">Contraseña del encargado</label><input id="activityCode" className="code-input" autoFocus autoComplete="off" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="INGRESA EL CÓDIGO" maxLength={32} required/><p className="field-hint">Solicita el código a la persona encargada de esta actividad.</p><button className="button button-primary button-wide" disabled={busy || !code.trim()}>{busy ? 'Validando…' : 'Validar y sumar puntos'}<ChevronRight size={18}/></button></form></section></div>}
    {toast && <ToastView toast={toast}/>}
  </div>;
}

function ToastView({ toast }: { toast: NonNullable<Toast> }) { return <div className={`toast toast-${toast.kind}`} role="status">{toast.kind === 'error' ? <CircleHelp size={18}/> : <CheckCircle2 size={18}/>}<span>{toast.text}</span></div>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><div><Clipboard size={25}/></div><h3>{title}</h3><p>{text}</p></div>; }
