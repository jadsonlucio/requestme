import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProjects } from '../api/projects';
import { getEnvironments, createEnvironment, updateEnvironment, deleteEnvironment } from '../api/environments';
import useStore from '../store';

export default function EnvironmentModal({ onClose }) {
  const queryClient = useQueryClient();
  const activeRequest = useStore((s) => s.activeRequest);
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects });

  const [selectedProjectId, setSelectedProjectId] = useState(
    activeRequest ? projects[0]?.id : projects[0]?.id
  );
  const [editingEnv, setEditingEnv] = useState(null);
  const [newEnvName, setNewEnvName] = useState('');

  const { data: environments = [] } = useQuery({
    queryKey: ['environments', selectedProjectId],
    queryFn: () => getEnvironments(selectedProjectId),
    enabled: !!selectedProjectId,
  });

  const createMutation = useMutation({
    mutationFn: ({ projectId, name }) => createEnvironment(projectId, { name, variables: [] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', selectedProjectId] });
      setNewEnvName('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateEnvironment(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['environments', selectedProjectId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['environments', selectedProjectId] }),
  });

  function handleSaveEnv() {
    if (!editingEnv) return;
    updateMutation.mutate({ id: editingEnv.id, data: { name: editingEnv.name, variables: editingEnv.variables } });
  }

  function addVariable() {
    setEditingEnv((e) => ({ ...e, variables: [...e.variables, { key: '', value: '' }] }));
  }

  function updateVariable(index, field, value) {
    setEditingEnv((e) => {
      const variables = e.variables.map((v, i) => (i === index ? { ...v, [field]: value } : v));
      return { ...e, variables };
    });
  }

  function removeVariable(index) {
    setEditingEnv((e) => ({ ...e, variables: e.variables.filter((_, i) => i !== index) }));
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-[640px] max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-gray-100 font-semibold">Manage Environments</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-48 border-r border-gray-700 flex flex-col">
            <div className="p-3 border-b border-gray-700">
              <select
                value={selectedProjectId ?? ''}
                onChange={(e) => { setSelectedProjectId(Number(e.target.value)); setEditingEnv(null); }}
                className="w-full bg-gray-700 text-gray-300 text-xs rounded px-1 py-1 outline-none"
              >
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {environments.map((env) => (
                <div
                  key={env.id}
                  onClick={() => setEditingEnv({ ...env })}
                  className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer text-xs group ${
                    editingEnv?.id === env.id ? 'bg-gray-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <span className="truncate">{env.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(env.id); if (editingEnv?.id === env.id) setEditingEnv(null); }}
                    className="hidden group-hover:block text-red-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-gray-700">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newEnvName.trim() || !selectedProjectId) return;
                  createMutation.mutate({ projectId: selectedProjectId, name: newEnvName.trim() });
                }}
              >
                <input
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  placeholder="New environment…"
                  className="w-full bg-gray-700 text-gray-100 rounded px-2 py-1 text-xs outline-none"
                />
              </form>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {editingEnv ? (
              <>
                <div className="mb-3">
                  <input
                    value={editingEnv.name}
                    onChange={(e) => setEditingEnv((env) => ({ ...env, name: e.target.value }))}
                    className="bg-gray-700 text-gray-100 rounded px-2 py-1 text-sm outline-none w-full"
                  />
                </div>
                <div className="space-y-1">
                  {editingEnv.variables.map((v, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        value={v.key}
                        onChange={(e) => updateVariable(i, 'key', e.target.value)}
                        placeholder="Variable"
                        className="flex-1 bg-gray-700 text-gray-100 rounded px-2 py-1 text-xs outline-none"
                      />
                      <input
                        value={v.value}
                        onChange={(e) => updateVariable(i, 'value', e.target.value)}
                        placeholder="Value"
                        className="flex-1 bg-gray-700 text-gray-100 rounded px-2 py-1 text-xs outline-none"
                      />
                      <button
                        onClick={() => removeVariable(i)}
                        className="text-red-500 hover:text-red-400 text-xs"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addVariable}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                >
                  + Add Variable
                </button>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleSaveEnv}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
                  >
                    Save
                  </button>
                </div>
              </>
            ) : (
              <p className="text-gray-500 text-xs">Select an environment to edit its variables.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
