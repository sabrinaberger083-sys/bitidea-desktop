import { useCallback, useEffect, useState } from 'react';
import Button from '../common/Button';
import type { Lang } from '../../types';
import { getTerminalConfig, saveTerminalConfig } from '../../lib/sidecar';

const COPY = {
  en: {
    title: 'TERMINAL BACKEND',
    backend: 'Backend',
    local: 'Local',
    docker: 'Docker',
    ssh: 'SSH',
    modal: 'Modal',
    singularity: 'Singularity',
    daytona: 'Daytona',
    docker_image: 'Docker image',
    ssh_host: 'SSH Host',
    ssh_user: 'SSH User',
    ssh_port: 'SSH Port',
    ssh_key: 'SSH Key path',
    modal_image: 'Modal image',
    save: 'Save',
    saving: 'Saving…',
  },
  zh: {
    title: '终端后端',
    backend: '后端',
    local: '本地',
    docker: 'Docker',
    ssh: 'SSH',
    modal: 'Modal',
    singularity: 'Singularity',
    daytona: 'Daytona',
    docker_image: 'Docker 镜像',
    ssh_host: 'SSH 主机',
    ssh_user: 'SSH 用户',
    ssh_port: 'SSH 端口',
    ssh_key: 'SSH 密钥路径',
    modal_image: 'Modal 镜像',
    save: '保存',
    saving: '保存中…',
  },
};

const BACKENDS = ['local', 'docker', 'ssh', 'modal', 'singularity', 'daytona'];

interface Props {
  lang: Lang;
}

export default function TerminalSettings({ lang }: Props) {
  const L = COPY[lang];

  const [backend, setBackend] = useState('local');
  const [dockerImage, setDockerImage] = useState('');
  const [sshHost, setSshHost] = useState('');
  const [sshUser, setSshUser] = useState('');
  const [sshPort, setSshPort] = useState(22);
  const [sshKey, setSshKey] = useState('');
  const [modalImage, setModalImage] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const cfg = await getTerminalConfig();
      setBackend(cfg.backend);
      setDockerImage(cfg.docker_image || '');
      setSshHost(cfg.ssh_host || '');
      setSshUser(cfg.ssh_user || '');
      setSshPort(cfg.ssh_port || 22);
      setSshKey(cfg.ssh_key || '');
      setModalImage(cfg.modal_image || '');
    } catch { /* sidecar not ready */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveTerminalConfig({
        backend,
        docker_image: dockerImage || undefined,
        ssh_host: sshHost || undefined,
        ssh_user: sshUser || undefined,
        ssh_port: sshPort,
        ssh_key: sshKey || undefined,
        modal_image: modalImage || undefined,
      });
    } catch { /* ignore */ }
    setSaving(false);
  }

  return (
    <section className="settings-section">
      <div className="label">{L.title}</div>

      <div className="field">
        <label className="label">{L.backend}</label>
        <select className="select mono" value={backend} onChange={(e) => setBackend(e.target.value)}>
          {BACKENDS.map((b) => (
            <option key={b} value={b}>{(L as Record<string, string>)[b] || b}</option>
          ))}
        </select>
      </div>

      {backend === 'docker' && (
        <div className="field">
          <label className="label">{L.docker_image}</label>
          <input className="input mono" value={dockerImage} onChange={(e) => setDockerImage(e.target.value)}
            placeholder="nikolaik/python-nodejs:python3.11-nodejs20" spellCheck={false} />
        </div>
      )}

      {backend === 'ssh' && (
        <>
          <div className="field">
            <label className="label">{L.ssh_host}</label>
            <input className="input mono" value={sshHost} onChange={(e) => setSshHost(e.target.value)}
              placeholder="192.168.1.100" spellCheck={false} />
          </div>
          <div className="field">
            <label className="label">{L.ssh_user}</label>
            <input className="input mono" value={sshUser} onChange={(e) => setSshUser(e.target.value)}
              placeholder="agent" spellCheck={false} />
          </div>
          <div className="field">
            <label className="label">{L.ssh_port}</label>
            <input className="input mono" type="number" value={sshPort}
              onChange={(e) => setSshPort(parseInt(e.target.value) || 22)} />
          </div>
          <div className="field">
            <label className="label">{L.ssh_key}</label>
            <input className="input mono" value={sshKey} onChange={(e) => setSshKey(e.target.value)}
              placeholder="~/.ssh/id_rsa" spellCheck={false} />
          </div>
        </>
      )}

      {backend === 'modal' && (
        <div className="field">
          <label className="label">{L.modal_image}</label>
          <input className="input mono" value={modalImage} onChange={(e) => setModalImage(e.target.value)}
            placeholder="nikolaik/python-nodejs:python3.11-nodejs20" spellCheck={false} />
        </div>
      )}

      <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving}>
        {saving ? L.saving : L.save}
      </Button>
    </section>
  );
}
