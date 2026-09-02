export async function api(url, options = {}) {
  const init = {
    method: options.method || 'GET',
    headers: { 'x-user-id': String(options.userId || 1), ...(options.headers || {}) }
  };
  if (options.body !== undefined) {
    if (options.raw) init.body = options.body;
    else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }
  const response = await fetch(url, init);
  if (response.status === 204) return null;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || data || `HTTP ${response.status}`);
  return data;
}

export function dateShort(value) {
  if (!value) return '—';
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.valueOf())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

export function dateTime(value) {
  if (!value) return '—';
  const normalized = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.valueOf())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

export function initials(name = '') {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'KB';
}
