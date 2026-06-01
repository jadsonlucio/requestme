import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProjects, createProject, deleteProject, importCollection } from '../../api/projects';
import ProjectItem from './ProjectItem';
import EnvironmentSelector from './EnvironmentSelector';

export default function Sidebar() {
  const queryClient = useQueryClient();
  const [newProjectName, setNewProjectName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

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

  const importMutation = useMutation({
    mutationFn: importCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setImportError('');
      fileInputRef.current.value = '';
    },
    onError: (err) => {
      setImportError(err.message);
      fileInputRef.current.value = '';
    },
  });

  function handleAddProject(e) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    createMutation.mutate(newProjectName.trim());
  }

  function handleImportClick() {
    setImportError('');
    fileInputRef.current.click();
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) importMutation.mutate(file);
  }

  return (
    <div className="w-60 shrink-0 bg-gray-800 flex flex-col border-r border-gray-700">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <span className="font-semibold text-gray-200">Projects</span>
        <div className="flex gap-2">
          <button
            onClick={handleImportClick}
            disabled={importMutation.isPending}
            className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + New
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {importError && (
        <p className="px-3 py-1 text-xs text-red-400 border-b border-gray-700">{importError}</p>
      )}

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
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            onDelete={() => deleteMutation.mutate(project.id)}
          />
        ))}
      </div>

      <EnvironmentSelector />
    </div>
  );
}
