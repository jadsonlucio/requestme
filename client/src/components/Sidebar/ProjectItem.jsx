import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRequests, createRequest, deleteRequest } from '../../api/requests';
import useStore from '../../store';

const METHOD_COLORS = {
  GET: 'text-green-400',
  POST: 'text-yellow-400',
  PUT: 'text-blue-400',
  PATCH: 'text-orange-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

export default function ProjectItem({ project, onDelete, filteredRequests = null }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [isAddingRequest, setIsAddingRequest] = useState(false);
  const [newRequestName, setNewRequestName] = useState('');

  const activeRequest = useStore((s) => s.activeRequest);
  const setActiveRequest = useStore((s) => s.setActiveRequest);

  const isSearching = filteredRequests !== null;

  const { data: ownRequests = [] } = useQuery({
    queryKey: ['requests', project.id],
    queryFn: () => getRequests(project.id),
    enabled: !isSearching && expanded,
  });

  const requests = isSearching ? filteredRequests : ownRequests;
  const isExpanded = isSearching || expanded;

  const createMutation = useMutation({
    mutationFn: (name) => createRequest(project.id, { name }),
    onSuccess: (newReq) => {
      queryClient.invalidateQueries({ queryKey: ['requests', project.id] });
      setNewRequestName('');
      setIsAddingRequest(false);
      setActiveRequest(newReq);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests', project.id] }),
  });

  function handleAddRequest(e) {
    e.preventDefault();
    if (!newRequestName.trim()) return;
    createMutation.mutate(newRequestName.trim());
  }

  return (
    <div className="border-b border-gray-700">
      <div className="flex items-center justify-between px-3 py-2 hover:bg-gray-750 group">
        <button
          onClick={() => !isSearching && setExpanded(!expanded)}
          className="flex items-center gap-1 text-gray-200 text-xs font-medium flex-1 text-left"
        >
          <span className="text-gray-500">{isExpanded ? '▾' : '▸'}</span>
          {project.name}
        </button>
        {!isSearching && (
          <div className="hidden group-hover:flex gap-2 items-center">
            <button
              onClick={() => setIsAddingRequest(true)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              +
            </button>
            <button
              onClick={onDelete}
              className="text-xs text-red-500 hover:text-red-400"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="pl-4">
          {!isSearching && isAddingRequest && (
            <form onSubmit={handleAddRequest} className="px-2 py-1">
              <input
                autoFocus
                value={newRequestName}
                onChange={(e) => setNewRequestName(e.target.value)}
                placeholder="Request name"
                className="w-full bg-gray-700 text-gray-100 rounded px-2 py-1 text-xs outline-none"
                onKeyDown={(e) => e.key === 'Escape' && setIsAddingRequest(false)}
              />
              <div className="flex gap-1 mt-1">
                <button type="submit" className="text-xs text-blue-400 hover:text-blue-300">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingRequest(false)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {requests.map((req) => (
            <div
              key={req.id}
              onClick={() => setActiveRequest(req)}
              className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded text-xs group/req ${
                activeRequest?.id === req.id ? 'bg-gray-600' : 'hover:bg-gray-700'
              }`}
            >
              <span className={`w-12 shrink-0 font-bold ${METHOD_COLORS[req.method] || 'text-gray-400'}`}>
                {req.method}
              </span>
              <span className="text-gray-300 truncate flex-1">{req.name}</span>
              {!isSearching && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(req.id); }}
                  className="hidden group-hover/req:block text-red-500 hover:text-red-400 shrink-0"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
