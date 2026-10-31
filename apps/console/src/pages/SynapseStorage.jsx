/*
 * Copyright 2026 SynapseDX Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React, { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBoxArchive,
  faCloudArrowUp,
  faDownload,
  faFolder,
  faLink,
  faPlus,
  faRotateRight,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../lib/auth.jsx';
import { api, baseUrl } from '../lib/api.js';
import { Badge, Btn, Card, Code, Empty, Err, Field, Input, Modal, PageTitle, Table, TableSkeleton } from '../components/ui.jsx';

function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function SynapseStorage() {
  const { headers } = useAuth();
  const [err, setErr] = useState(null);
  const [stats, setStats] = useState(null);
  const [buckets, setBuckets] = useState(null);
  const [bucket, setBucket] = useState(null);
  const [prefix, setPrefix] = useState('');
  const [listing, setListing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newBucket, setNewBucket] = useState('documents');
  const [uploadKey, setUploadKey] = useState('');
  const [link, setLink] = useState(null);
  const fileRef = useRef(null);
  const seq = useRef(0);

  const loadBuckets = async () => {
    setErr(null);
    try {
      const [s, b] = await Promise.all([api.storageStats(headers), api.storageBuckets(headers)]);
      setStats(s);
      const list = Array.isArray(b) ? b : [];
      setBuckets(list);
      if (!bucket && list.length) setBucket(list[0].name);
      if (bucket && !list.some((x) => x.name === bucket)) setBucket(list[0]?.name || null);
    } catch (e) {
      setErr(e);
      setBuckets([]);
    }
  };

  const loadObjects = async () => {
    if (!bucket) return setListing(null);
    const my = ++seq.current;
    setListing(null);
    try {
      const r = await api.storageObjects(bucket, { prefix, delimiter: '/', limit: 200 }, headers);
      if (seq.current === my) setListing(r);
    } catch (e) {
      if (seq.current === my) {
        setErr(e);
        setListing({ items: [], prefixes: [] });
      }
    }
  };

  useEffect(() => { loadBuckets(); }, [headers]);
  useEffect(() => { loadObjects(); }, [bucket, prefix, headers]);

  const createBucket = async (e) => {
    e.preventDefault();
    setBusy('create');
    setErr(null);
    try {
      await api.storageCreateBucket(newBucket.trim(), null, headers);
      setCreateOpen(false);
      setBucket(newBucket.trim());
      await loadBuckets();
    } catch (ex) {
      setErr(ex);
    } finally {
      setBusy(null);
    }
  };

  const deleteBucket = async () => {
    if (!bucket) return;
    if (!window.confirm(`Delete bucket "${bucket}" and ALL of its objects?`)) return;
    setBusy('delete-bucket');
    try {
      await api.storageDeleteBucket(bucket, true, headers);
      setBucket(null);
      setPrefix('');
      await loadBuckets();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!bucket || !file) return setErr(new Error('Choose a bucket and a file first'));
    const key = (uploadKey.trim() || `${prefix}${file.name}`).replace(/^\/+/, '');
    setBusy('upload');
    setErr(null);
    try {
      await api.storageUpload(bucket, key, file, file.type || 'application/octet-stream', headers);
      setUploadKey('');
      if (fileRef.current) fileRef.current.value = '';
      await loadObjects();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const download = async (key) => {
    setBusy(`dl:${key}`);
    try {
      const { blob } = await api.storageDownload(bucket, key, headers);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = key.split('/').pop() || 'object';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (key) => {
    if (!window.confirm(`Delete "${key}"?`)) return;
    setBusy(`rm:${key}`);
    try {
      await api.storageDeleteObject(bucket, key, headers);
      await loadObjects();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const share = async (key) => {
    setBusy(`ln:${key}`);
    try {
      const r = await api.storagePresignDownload(bucket, key, 3600, headers);
      const url = /^https?:/.test(r.url) ? r.url : `${baseUrl()}${r.path}`;
      setLink({ key, url, expiresAt: r.expiresAt });
      try { await navigator.clipboard?.writeText(url); } catch { /* clipboard optional */ }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  const crumbs = prefix ? prefix.replace(/\/$/, '').split('/') : [];

  return (
    <>
      <PageTitle
        title="Synapse Storage"
        sub="Object storage for files, images and documents — tenant-scoped buckets on an S3-compatible backend"
        right={<Btn onClick={() => setCreateOpen(true)}><FontAwesomeIcon icon={faPlus} className="mr-1.5" />New bucket</Btn>}
      />
      <Err e={err} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Card><div className="text-xs text-normal-text">Backend</div><div className="text-lg font-semibold text-main-text">{stats?.backend || '—'}</div></Card>
        <Card><div className="text-xs text-normal-text">Buckets</div><div className="text-lg font-semibold text-main-text">{stats ? `${stats.buckets} / ${stats.maxBuckets}` : '—'}</div></Card>
        <Card><div className="text-xs text-normal-text">Max object size</div><div className="text-lg font-semibold text-main-text">{stats ? bytes(stats.maxObjectBytes) : '—'}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-main-text">Buckets</h3>
            <button onClick={loadBuckets} className="text-xs text-normal-text" title="Refresh"><FontAwesomeIcon icon={faRotateRight} /></button>
          </div>
          {buckets === null ? (
            <TableSkeleton rows={3} cols={1} />
          ) : buckets.length ? (
            <ul className="space-y-1">
              {buckets.map((b) => (
                <li key={b.name}>
                  <button
                    onClick={() => { setBucket(b.name); setPrefix(''); }}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm ${bucket === b.name ? 'bg-main-blue/10 text-main-blue font-medium' : 'text-main-text hover:bg-slate-100'}`}
                  >
                    <FontAwesomeIcon icon={faBoxArchive} className="mr-2 opacity-70" />{b.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No buckets yet" />
          )}
        </Card>

        <div className="lg:col-span-3">
          <Card>
            {!bucket ? (
              <Empty text="Create or pick a bucket" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
                  <button onClick={() => setPrefix('')} className="font-semibold text-main-text">{bucket}</button>
                  {crumbs.map((c, i) => (
                    <span key={i} className="text-normal-text">
                      / <button onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/') + '/')} className="hover:underline">{c}</button>
                    </span>
                  ))}
                  <span className="flex-1" />
                  <Btn kind="ghost" onClick={deleteBucket} loading={busy === 'delete-bucket'}><FontAwesomeIcon icon={faTrash} className="mr-1.5" />Delete bucket</Btn>
                </div>

                <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded bg-slate-50">
                  <div className="flex-1 min-w-[180px]">
                    <Field label="File">
                      <input ref={fileRef} type="file" className="text-sm" />
                    </Field>
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <Field label={`Key (default: ${prefix || ''}<file name>)`}>
                      <Input value={uploadKey} onChange={(e) => setUploadKey(e.target.value)} placeholder="reports/2026/q3.pdf" />
                    </Field>
                  </div>
                  <div className="mb-4">
                    <Btn onClick={upload} loading={busy === 'upload'}><FontAwesomeIcon icon={faCloudArrowUp} className="mr-1.5" />Upload</Btn>
                  </div>
                </div>

                {listing === null ? (
                  <TableSkeleton rows={4} cols={4} />
                ) : listing.items.length || listing.prefixes.length ? (
                  <Table head={['Key', 'Size', 'Modified', '']}>
                    {listing.prefixes.map((p) => (
                      <tr key={p} className="border-t border-slate-100">
                        <td className="py-2 pr-4" colSpan={4}>
                          <button onClick={() => setPrefix(p)} className="text-main-text hover:underline">
                            <FontAwesomeIcon icon={faFolder} className="mr-2 text-amber-500" />{p.slice(prefix.length)}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {listing.items.map((o) => (
                      <tr key={o.key} className="border-t border-slate-100">
                        <td className="py-2 pr-4 font-mono text-xs text-main-text">{o.key.slice(prefix.length)}</td>
                        <td className="py-2 pr-4 text-xs text-normal-text">{bytes(o.size)}</td>
                        <td className="py-2 pr-4 text-xs text-normal-text">{new Date(o.lastModified).toLocaleString()}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button onClick={() => download(o.key)} disabled={busy === `dl:${o.key}`} className="text-xs text-main-blue mr-3" title="Download">
                            <FontAwesomeIcon icon={faDownload} />
                          </button>
                          <button onClick={() => share(o.key)} disabled={busy === `ln:${o.key}`} className="text-xs text-main-blue mr-3" title="Signed link (1 h)">
                            <FontAwesomeIcon icon={faLink} />
                          </button>
                          <button onClick={() => remove(o.key)} disabled={busy === `rm:${o.key}`} className="text-xs text-red-500" title="Delete">
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <Empty text={prefix ? 'Nothing under this prefix' : 'Bucket is empty — upload a file'} />
                )}
              </>
            )}
          </Card>
          <p className="mt-3 text-xs text-normal-text">
            <Badge>Access</Badge> Requests are authorized as <code>storage:Read</code> / <code>storage:Write</code> / <code>storage:Delete</code>
            {' '}— grant them with the managed policies <code>StorageReadOnlyAccess</code> or <code>StorageFullAccess</code>.
          </p>
        </div>
      </div>

      {createOpen && (
        <Modal title="New bucket" onClose={() => setCreateOpen(false)}>
          <form onSubmit={createBucket}>
            <Field label="Name (3–63 chars: a-z, 0-9, -)">
              <Input value={newBucket} onChange={(e) => setNewBucket(e.target.value)} />
            </Field>
            <Btn type="submit" loading={busy === 'create'}>Create</Btn>
          </form>
        </Modal>
      )}
      {link && (
        <Modal title="Signed download link (copied)" onClose={() => setLink(null)}>
          <p className="text-sm text-normal-text mb-2">Anyone with this link can download <b>{link.key}</b> until it expires — no credentials needed.</p>
          <Code data={{ url: link.url, expiresAt: link.expiresAt }} wrap />
        </Modal>
      )}
    </>
  );
}
