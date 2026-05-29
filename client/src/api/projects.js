import { apiFetch } from './client';

export const getProjects = () => apiFetch('/projects');
export const createProject = (name) => apiFetch('/projects', { method: 'POST', body: { name } });
export const updateProject = (id, name) => apiFetch(`/projects/${id}`, { method: 'PUT', body: { name } });
export const deleteProject = (id) => apiFetch(`/projects/${id}`, { method: 'DELETE' });
