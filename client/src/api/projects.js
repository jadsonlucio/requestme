import { apiFetch } from './client';

export const getProjects = () => apiFetch('/projects');
export const createProject = (name) => apiFetch('/projects', { method: 'POST', body: { name } });
export const updateProject = (id, name) => apiFetch(`/projects/${id}`, { method: 'PUT', body: { name } });
export const deleteProject = (id) => apiFetch(`/projects/${id}`, { method: 'DELETE' });

export const importCollection = async (file) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/projects/import', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
