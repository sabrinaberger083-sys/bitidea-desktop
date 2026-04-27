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
import { collapsePath } from '../../lib/path';
import './ProjectPicker.css';

const COPY = {
  en: {
    all: 'All conversations',
    allMeta: 'No project scope',
    current: 'Current',
    currentProject: 'Current project',
    projectScope: 'Project scope',
    newProject: 'New project',
    selectFolder: 'Select folder',
    rename: 'Rename',
    remove: 'Remove',
  },
  zh: {
    all: '所有对话',
    allMeta: '不限制项目范围',
    current: '当前',
    currentProject: '当前项目',
    projectScope: '项目范围',
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

function ProjectGlyph({ kind }: { kind: 'folder' | 'chat' | 'add' }) {
  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M1.75 4.75a1.5 1.5 0 0 1 1.5-1.5h2.3c.35 0 .69.12.95.34l1.12.91c.18.15.41.23.65.23h4.53a1.5 1.5 0 0 1 1.5 1.5v4.57a1.5 1.5 0 0 1-1.5 1.5H3.25a1.5 1.5 0 0 1-1.5-1.5z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (kind === 'chat') {
    return (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 4.25A1.75 1.75 0 0 1 4.75 2.5h6.5A1.75 1.75 0 0 1 13 4.25v4.25a1.75 1.75 0 0 1-1.75 1.75H8.8l-2.15 2.01c-.45.42-1.18.1-1.18-.51v-1.5h-.72A1.75 1.75 0 0 1 3 8.5z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
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
  const currentMeta = currentProject ? collapsePath(currentProject.path) : L.allMeta;
  const currentMetaTitle = currentProject?.path ?? L.allMeta;

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
    <div className={`project-picker${open_ ? ' project-picker-open' : ''}`} ref={dropdownRef}>
      <button
        type="button"
        className="project-picker-toggle"
        onClick={() => setOpen_(!open_)}
        aria-expanded={open_}
      >
        <span className="project-picker-icon">
          <ProjectGlyph kind={currentProject ? 'folder' : 'chat'} />
        </span>
        <span className="project-picker-copy">
          <span className="project-picker-eyebrow">
            {currentProject ? L.currentProject : L.projectScope}
          </span>
          <span className="project-picker-label-row">
            <span className="project-picker-label">
              {currentProject ? currentProject.name : L.all}
            </span>
            {currentProject && (
              <span className="project-picker-badge">{L.current}</span>
            )}
          </span>
          <span className="project-picker-meta" title={currentMetaTitle}>
            {currentMeta}
          </span>
        </span>
        <span className="project-picker-arrow">{open_ ? '▲' : '▼'}</span>
      </button>

      {open_ && (
        <div className="project-dropdown">
          <button
            type="button"
            className={`project-dropdown-item project-dropdown-item-plain ${currentProjectId === null ? 'project-dropdown-item-active' : ''}`}
            onClick={() => handleSelect(null)}
          >
            <span className="project-dropdown-icon"><ProjectGlyph kind="chat" /></span>
            <span className="project-dropdown-copy">
              <span className="project-dropdown-row">
                <span className="project-dropdown-name">{L.all}</span>
                {currentProjectId === null && (
                  <span className="project-dropdown-badge">{L.current}</span>
                )}
              </span>
              <span className="project-dropdown-path">{L.allMeta}</span>
            </span>
          </button>

          {projects.length > 0 && <div className="project-dropdown-divider" />}

          {projects.map((proj) => (
            <div
              key={proj.id}
              className={`project-dropdown-item ${currentProjectId === proj.id ? 'project-dropdown-item-active' : ''}`}
            >
              {renamingId === proj.id ? (
                <div className="project-dropdown-rename">
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
                <>
                  <button
                    type="button"
                    className="project-dropdown-main"
                    onClick={() => handleSelect(proj.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      startRename(e, proj);
                    }}
                  >
                    <span className="project-dropdown-icon"><ProjectGlyph kind="folder" /></span>
                    <span className="project-dropdown-copy">
                      <span className="project-dropdown-row">
                        <span className="project-dropdown-name">{proj.name}</span>
                        {currentProjectId === proj.id && (
                          <span className="project-dropdown-badge">{L.current}</span>
                        )}
                      </span>
                      <span className="project-dropdown-path" title={proj.path}>
                        {collapsePath(proj.path)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="project-dropdown-delete"
                    title={L.remove}
                    aria-label={L.remove}
                    onClick={(e) => handleDeleteClick(e, proj.id)}
                  >
                    {'✕'}
                  </button>
                </>
              )}
            </div>
          ))}

          <div className="project-dropdown-divider" />

          <button
            type="button"
            className="project-dropdown-item project-dropdown-item-plain project-dropdown-new"
            onClick={handleNewProject}
          >
            <span className="project-dropdown-icon"><ProjectGlyph kind="add" /></span>
            <span className="project-dropdown-copy">
              <span className="project-dropdown-row">
                <span className="project-dropdown-name">{L.newProject}</span>
              </span>
              <span className="project-dropdown-path">{L.selectFolder}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
