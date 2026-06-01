import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProjects, createProject, deleteProject } from '../../api/projects';
import { searchRequests } from '../../api/requests';
import ProjectItem from './ProjectItem';
import EnvironmentSelector from './EnvironmentSelector';

export default function Sidebar() {
  const queryClient = useQueryClient();
  const [newProjectName, setNewProjectName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  const { data: searchResults = [], isLoading: isSearchLoading } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => searchRequests(debouncedQuery),
    enabled: debouncedQuery.length > 0,
  });

  const searchMap = debouncedQuery.length > 0 && !isSearchLoading
    ? searchResults.reduce((m, r) => {
        if (!m.has(r.project_id)) m.set(r.project_id, []);
        m.get(r.project_id).push(r);
        return m;
      }, new Map())
    : null;

  const createMutation = useMutation({
    mutationFn: (name) => createProject(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setNewProjectName('');
      setIsAdding(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  function handleAddProject(e) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    createMutation.mutate(newProjectName.trim());
  }

  const visibleProjects = searchMap
    ? projects.filter((p) => searchMap.has(p.id))
    : projects;

  return (
    <div className="w-60 shrink-0 bg-gray-800 flex flex-col border-r border-gray-700">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <span className="font-semibold text-gray-200">Projects</span>
        <button
          onClick={() => setIsAdding(true)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + New
        </button>
      </div>

      <div className="px-3 py-2 border-b border-gray-700">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search requests..."
          className="w-full bg-gray-700 text-gray-300 rounded px-2 py-1 text-xs outline-none placeholder-gray-500"
        />
      </div>

      {isAdding && (
        <form onSubmit={handleAddProject} className="p-2 border-b border-gray-700">
          <input
            autoFocus
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="Project name"
            className="w-full bg-gray-700 text-gray-100 rounded px-2 py-1 text-xs outline-none"
            onKeyDown={(e) => e.key === 'Escape' && setIsAdding(false)}
          />
          <div className="flex gap-1 mt-1">
            <button type="submit" className="text-xs text-blue-400 hover:text-blue-300">
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto">
        {visibleProjects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            onDelete={() => deleteMutation.mutate(project.id)}
            filteredRequests={searchMap ? (searchMap.get(project.id) ?? []) : null}
          />
        ))}
      </div>

      <EnvironmentSelector />
    </div>
  );
}
