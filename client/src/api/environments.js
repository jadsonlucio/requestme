import { apiFetch } from './client';

function parseEnv(env) {
  return {
    ...env,
    variables: typeof env.variables === 'string' ? JSON.parse(env.variables) : (env.variables ?? []),
  };
}

export const getEnvironments = async (projectId) => {
  const list = await apiFetch(`/projects/${projectId}/environments`);
  return list.map(parseEnv);
};

export const createEnvironment = async (projectId, data) => {
  const env = await apiFetch(`/projects/${projectId}/environments`, { method: 'POST', body: data });
  return parseEnv(env);
};

export const updateEnvironment = async (id, data) => {
  const env = await apiFetch(`/environments/${id}`, { method: 'PUT', body: data });
  return parseEnv(env);
};

export const deleteEnvironment = (id) => apiFetch(`/environments/${id}`, { method: 'DELETE' });
