import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getProjects } from '../../api/projects';
import { getEnvironments } from '../../api/environments';
import useStore from '../../store';
import EnvironmentModal from '../EnvironmentModal';

export default function EnvironmentSelector() {
  const [modalOpen, setModalOpen] = useState(false);
  const activeEnvironmentId = useStore((s) => s.activeEnvironmentId);
  const setActiveEnvironmentId = useStore((s) => s.setActiveEnvironmentId);
  const activeRequest = useStore((s) => s.activeRequest);
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects });

  const activeProjectId = (() => {
    if (!activeRequest) return projects[0]?.id ?? null;
    for (const p of projects) {
      const cached = queryClient.getQueryData(['requests', p.id]);
      if (cached?.find?.((r) => r.id === activeRequest.id)) return p.id;
    }
    return projects[0]?.id ?? null;
  })();

  const { data: environments = [] } = useQuery({
    queryKey: ['environments', activeProjectId],
    queryFn: () => getEnvironments(activeProjectId),
    enabled: !!activeProjectId,
  });

  return (
    <>
      <div className="p-3 border-t border-gray-700 flex items-center gap-2">
        <span className="text-xs text-gray-500 shrink-0">Env:</span>
        <select
          value={activeEnvironmentId ?? ''}
          onChange={(e) => setActiveEnvironmentId(e.target.value ? Number(e.target.value) : null)}
          className="flex-1 bg-gray-700 text-gray-300 text-xs rounded px-1 py-0.5 outline-none"
        >
          <option value="">None</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>{env.name}</option>
          ))}
        </select>
        <button
          onClick={() => setModalOpen(true)}
          className="text-xs text-blue-400 hover:text-blue-300 shrink-0"
        >
          Manage
        </button>
      </div>
      {modalOpen && <EnvironmentModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
