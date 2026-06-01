import { apiFetch } from './client';

function parseRequest(req) {
  return {
    ...req,
    headers: typeof req.headers === 'string' ? JSON.parse(req.headers) : (req.headers ?? []),
    auth_config: typeof req.auth_config === 'string' ? JSON.parse(req.auth_config) : (req.auth_config ?? {}),
  };
}

export const getRequests = async (projectId) => {
  const list = await apiFetch(`/projects/${projectId}/requests`);
  return list.map(parseRequest);
};

export const createRequest = async (projectId, data) => {
  const req = await apiFetch(`/projects/${projectId}/requests`, { method: 'POST', body: data });
  return parseRequest(req);
};

export const updateRequest = async (id, data) => {
  const req = await apiFetch(`/requests/${id}`, { method: 'PUT', body: data });
  return parseRequest(req);
};

export const deleteRequest = (id) => apiFetch(`/requests/${id}`, { method: 'DELETE' });

export const searchRequests = async (q) => {
  const list = await apiFetch(`/requests/search?q=${encodeURIComponent(q)}`);
  return list.map(parseRequest);
};
