import { useEffect, useState } from 'react';
import Button from '../common/Button';
import type { Assistant, Lang } from '../../types';
import './AssistantEditor.css';

const ICONS = ['🤖', '💬', '📚', '🔧', '🎯', '🧠', '🔬', '🎨', '📊', '⚡'];

const COPY = {
  en: {
    createTitle: 'New Assistant',
    editTitle: 'Edit Assistant',
    viewTitle: 'View Assistant',
    name: 'Name',
    namePlaceholder: 'Assistant name',
    description: 'Description',
    descPlaceholder: 'Brief description',
    prompt: 'System Prompt',
    promptPlaceholder: "Enter the system prompt that defines this assistant's behavior...",
    icon: 'Icon',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
  },
  zh: {
    createTitle: '新建助手',
    editTitle: '编辑助手',
    viewTitle: '查看助手',
    name: '名称',
    namePlaceholder: '助手名称',
    description: '描述',
    descPlaceholder: '简短描述',
    prompt: '系统提示词',
    promptPlaceholder: '输入定义助手行为的系统提示词...',
    icon: '图标',
    save: '保存',
    cancel: '取消',
    delete: '删除',
  },
};

interface Props {
  lang: Lang;
  open: boolean;
  assistant?: Assistant | null;
  onSave: (data: {
    id: string;
    name: string;
    description: string;
    icon: string;
    system_prompt: string;
  }) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

export default function AssistantEditor({
  lang,
  open,
  assistant,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const L = COPY[lang];

  const isEdit = !!assistant;
  const isBuiltin = !!assistant?.builtin;
  const isReadOnly = isBuiltin;

  const [id] = useState<string>(() => crypto.randomUUID());
  const [icon, setIcon] = useState<string>(ICONS[0]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // Sync form state whenever the modal opens or the assistant prop changes.
  useEffect(() => {
    if (!open) return;
    if (assistant) {
      setIcon(assistant.icon || ICONS[0]);
      setName(assistant.name);
      setDescription(assistant.description);
      setSystemPrompt(assistant.system_prompt);
    } else {
      setIcon(ICONS[0]);
      setName('');
      setDescription('');
      setSystemPrompt('');
    }
  }, [open, assistant]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSave = name.trim().length > 0 && systemPrompt.trim().length > 0;

  function handleSave() {
    if (!canSave || isReadOnly) return;
    onSave({
      id: isEdit ? assistant!.id : id,
      name: name.trim(),
      description: description.trim(),
      icon,
      system_prompt: systemPrompt,
    });
  }

  function handleDelete() {
    if (!isEdit || isBuiltin || !onDelete) return;
    onDelete(assistant!.id);
  }

  const title = isReadOnly ? L.viewTitle : isEdit ? L.editTitle : L.createTitle;

  return (
    <div
      className="ae-backdrop"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label={title}
    >
      <div
        className="ae-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ae-head">
          <span className="ae-title">{title}</span>
          <button
            type="button"
            className="ae-close"
            onClick={onClose}
            aria-label={L.cancel}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="ae-body">
          {/* Icon selector */}
          <div className="ae-field">
            <label className="label">{L.icon}</label>
            <div className="ae-icon-grid">
              {ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`ae-icon-btn${icon === emoji ? ' selected' : ''}${isReadOnly ? ' readonly' : ''}`}
                  onClick={() => !isReadOnly && setIcon(emoji)}
                  aria-label={emoji}
                  aria-pressed={icon === emoji}
                  tabIndex={isReadOnly ? -1 : 0}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="ae-field">
            <label className="label" htmlFor="ae-name">{L.name}</label>
            <input
              id="ae-name"
              className="input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={L.namePlaceholder}
              readOnly={isReadOnly}
              spellCheck={false}
            />
          </div>

          {/* Description */}
          <div className="ae-field">
            <label className="label" htmlFor="ae-desc">{L.description}</label>
            <input
              id="ae-desc"
              className="input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={L.descPlaceholder}
              readOnly={isReadOnly}
              spellCheck={false}
            />
          </div>

          {/* System Prompt */}
          <div className="ae-field ae-field-grow">
            <label className="label" htmlFor="ae-prompt">{L.prompt}</label>
            <textarea
              id="ae-prompt"
              className="textarea ae-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={L.promptPlaceholder}
              readOnly={isReadOnly}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="ae-foot">
          {isEdit && !isBuiltin && onDelete && (
            <Button variant="danger" size="md" onClick={handleDelete}>
              {L.delete}
            </Button>
          )}
          <div className="ae-foot-right">
            <Button variant="secondary" size="md" onClick={onClose}>
              {L.cancel}
            </Button>
            {!isReadOnly && (
              <Button
                variant="primary"
                size="md"
                disabled={!canSave}
                onClick={handleSave}
              >
                {L.save}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
