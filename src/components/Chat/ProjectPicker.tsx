import { useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { Lang, Project } from '../../types';
import {
  createProject,
  deleteProject,
  getProjectByPath,
  listProjects,
  renameProject,
} from '../../lib/db';
import './ProjectPicker.css';

const COPY = {
  en: {
    all: 'All conversations',
    newProject: 'New project',
    selectFolder: 'Select folder',
    rename: 'Rename',
    remove: 'Remove',
  },
  zh: {
    all: '所有对话',
    newProject: '新建项目',
    selectFolder: '选择文件夹',
    rename: '重命名',
    remove: '删除项目',
  },
};

interface Props {
  lang: Lang;
  currentProjectId: string | null;
  onProjectChange: (projectId: string | null, projectPath?: string) => void;
}

export default function ProjectPicker({ lang, currentProjectId, onProjectChange }: Props) {
  const L = COPY[lang];
  const [projects, setProjects] = useState<Project[]>([]);
  const [open_, setOpen_] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (e) {
      console.error('failed to list projects', e);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open_) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen_(false);
        setRenamingId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open_]);

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  async function handleNewProject() {
    try {
      const selected = await open({ directory: true });
      if (!selected) return;
      const dirPath = typeof selected === 'string' ? selected : selected;
      // Check if project with this path already exists
      const existing = await getProjectByPath(dirPath);
      if (existing) {
        onProjectChange(existing.id, existing.path);
        setOpen_(false);
        return;
      }
      // Derive name from the last directory segment
      const segments = dirPath.replace(/[/\\]+$/, '').split(/[/\\]/);
      const name = segments[segments.length - 1] || dirPath;
      const id = crypto.randomUUID();
      await createProject(id, name, dirPath);
      await refresh();
      onProjectChange(id, dirPath);
    } catch (e) {
      console.error('project creation failed', e);
    }
    setOpen_(false);
  }

  async function handleSelect(projectId: string | null) {
    if (projectId === null) {
      onProjectChange(null);
    } else {
      const proj = projects.find((p) => p.id === projectId);
      onProjectChange(projectId, proj?.path);
    }
    setOpen_(false);
  }

  async function handleRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    try {
      await renameProject(id, trimmed);
      await refresh();
    } catch (e) {
      console.error('rename project failed', e);
    }
    setRenamingId(null);
  }

  async function handleDelete(id: string) {
    try {
      await deleteProject(id);
      await refresh();
      if (currentProjectId === id) {
        onProjectChange(null);
      }
    } catch (e) {
      console.error('delete project failed', e);
    }
  }

  function startRename(e: React.MouseEvent, proj: Project) {
    e.stopPropagation();
    setRenamingId(proj.id);
    setRenameValue(proj.name);
  }

  function handleDeleteClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    handleDelete(id);
  }

  return (
    <div className="project-picker" ref={dropdownRef}>
      <button
        type="button"
        className="project-picker-toggle"
        onClick={() => setOpen_(!open_)}
      >
        <span className="project-picker-icon">
          {currentProject ? '\u{1F4C1}' : '\u{1F4AC}'}
        </span>
        <span className="project-picker-label">
          {currentProject ? currentProject.name : L.all}
        </span>
        <span className="project-picker-arrow">{open_ ? '▲' : '▼'}</span>
      </button>

      {open_ && (
        <div className="project-dropdown">
          {/* All conversations */}
          <button
            type="button"
            className={`project-dropdown-item ${currentProjectId === null ? 'project-dropdown-item-active' : ''}`}
            onClick={() => handleSelect(null)}
          >
            <span className="project-dropdown-icon">{'\u{1F4AC}'}</span>
            <span className="project-dropdown-name">{L.all}</span>
          </button>

          {projects.length > 0 && <div className="project-dropdown-divider" />}

          {/* Project list */}
          {projects.map((proj) => (
            <div key={proj.id}>
              {renamingId === proj.id ? (
                <div style={{ padding: '4px 10px' }}>
                  <input
                    className="project-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(proj.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onBlur={() => handleRename(proj.id)}
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={`project-dropdown-item ${currentProjectId === proj.id ? 'project-dropdown-item-active' : ''}`}
                  onClick={() => handleSelect(proj.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    startRename(e, proj);
                  }}
                >
                  <span className="project-dropdown-icon">{'\u{1F4C1}'}</span>
                  <span className="project-dropdown-name">{proj.name}</span>
                  <span className="project-dropdown-path" title={proj.path}>
                    {proj.path.split(/[/\\]/).slice(-2).join('/')}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    style={{ fontSize: 11, opacity: 0.4, cursor: 'pointer', marginLeft: 2 }}
                    title={L.remove}
                    onClick={(e) => handleDeleteClick(e, proj.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleDeleteClick(e as unknown as React.MouseEvent, proj.id); }}
                  >
                    {'✕'}
                  </span>
                </button>
              )}
            </div>
          ))}

          <div className="project-dropdown-divider" />

          {/* New project */}
          <button
            type="button"
            className="project-dropdown-item project-dropdown-new"
            onClick={handleNewProject}
          >
            <span className="project-dropdown-icon">+</span>
            <span className="project-dropdown-name">{L.newProject}</span>
          </button>
        </div>
      )}
    </div>
  );
}
