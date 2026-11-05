// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowDown,
  faArrowUpRightFromSquare,
  faBolt,
  faBook,
  faCode,
  faCodeBranch,
  faCube,
  faCubes,
  faDatabase,
  faKey,
  faLayerGroup,
  faRobot,
  faScaleBalanced,
  faShieldHalved,
} from '@fortawesome/free-solid-svg-icons';
import PublicHeader from '../components/PublicHeader.jsx';
import PublicFooter from '../components/PublicFooter.jsx';
import { useI18n } from '../lib/i18n-context.js';

// Icons in the same order as `about.features` in src/locales.
const FEATURE_ICONS = [faShieldHalved, faKey, faBolt, faDatabase, faLayerGroup, faRobot];

// Each link shows the host it opens, so readers know where they are going.
const LINKS = [
  { key: 'repo', icon: faCodeBranch, host: 'github.com', href: 'https://github.com/vku-open-source-2026/SynapseOne' },
  { key: 'docs', icon: faBook, host: 'github.com', href: 'https://github.com/vku-open-source-2026/SynapseOne/tree/main/docs' },
  { key: 'api', icon: faCode, host: '/api-docs', href: '/api-docs' },
  { key: 'npm', icon: faCube, host: 'npmjs.com', href: 'https://www.npmjs.com/package/@synapseone/sdk' },
  { key: 'pypi', icon: faCubes, host: 'pypi.org', href: 'https://pypi.org/project/synapseone-sdk/' },
  { key: 'license', icon: faScaleBalanced, host: 'github.com', href: 'https://github.com/vku-open-source-2026/SynapseOne/blob/main/LICENSE' },
];

// Team order as on the other Synapse sites.
const TEAM = [
  { name: 'Hồ Sỹ Bảo Nhân', avatar: '/avatars/nhan.jpg' },
  { name: 'Võ Thành Nam' },
  { name: 'Trần Thị Thùy Dương', avatar: '/avatars/duong.jpg' },
];

const PARTNERS = [
  { key: 'vku', href: 'https://vku.udn.vn', logo: '/vku-logo.svg' },
  { key: 'vic', href: 'https://www.facebook.com/vic.club.vku?locale=vi_VN', logo: '/vic-logo.svg' },
];

const H2 = 'text-2xl font-semibold tracking-tight text-balance';

function Avatar({ member }) {
  const [failed, setFailed] = useState(false);
  if (member.avatar && !failed) {
    return (
      <img
        src={member.avatar}
        alt=""
        onError={() => setFailed(true)}
        className="h-14 w-14 shrink-0 rounded-full object-cover"
      />
    );
  }
  // No photo: the given name's initial.
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-s1-accent-soft text-xl font-semibold text-s1-accent">
      {member.name.split(' ').pop().charAt(0)}
    </span>
  );
}

export default function About() {
  const { m } = useI18n();
  const a = m.about;
  return (
    <div className="min-h-screen bg-s1-bg text-s1-fg">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 pt-28 sm:pt-32 pb-20">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-s1-accent">{a.kicker}</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl">{a.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-s1-muted">{a.intro}</p>
        </header>

        <section className="mt-20">
          <h2 className={H2}>{a.featuresHeading}</h2>
          <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-s1-line bg-s1-line sm:grid-cols-2 lg:grid-cols-3">
            {a.features.map((f, i) => (
              <div key={f.title} className="bg-s1-surface p-6">
                <FontAwesomeIcon icon={FEATURE_ICONS[i]} className="text-lg text-s1-accent" />
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-s1-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 grid gap-12 lg:grid-cols-2">
          <div className="min-w-0">
            <h2 className={H2}>{a.openSourceTitle}</h2>
            <p className="mt-3 leading-relaxed text-s1-muted">{a.openSourceText}</p>
            <ul className="mt-6 divide-y divide-s1-line border-y border-s1-line">
              {LINKS.map((l) => {
                const external = !l.href.startsWith('/');
                const inner = (
                  <>
                    <FontAwesomeIcon icon={l.icon} className="w-4 text-s1-muted transition group-hover:text-s1-accent" />
                    <span className="min-w-0 flex-1 truncate font-medium">{a.links[l.key]}</span>
                    <span className="shrink-0 font-mono text-xs text-s1-muted">{l.host}</span>
                    {external && <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="text-[10px] text-s1-muted" />}
                  </>
                );
                const cls = 'group flex items-center gap-3 py-3 text-sm transition hover:text-s1-accent';
                return (
                  <li key={l.href}>
                    {external ? (
                      <a href={l.href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
                    ) : (
                      <Link to={l.href} className={cls}>{inner}</Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="min-w-0">
            <h2 className={H2}>{a.tiersTitle}</h2>
            {/* Tier 3 on top, this platform at the base; each arrow names how the upper tier calls the lower one. */}
            <ol className="mt-6">
              {a.tierStack.map((tier, i) => {
                const base = i === a.tierStack.length - 1;
                return (
                  <li key={tier.name}>
                    <div
                      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3.5 ${
                        base ? 'border-s1-accent bg-s1-accent-soft' : 'border-s1-line bg-s1-surface'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-3 font-medium">
                        <FontAwesomeIcon icon={faLayerGroup} className={base ? 'text-s1-accent' : 'text-s1-muted'} />
                        <span className="truncate">{tier.name}</span>
                      </span>
                      <span className={`shrink-0 font-mono text-xs ${base ? 'text-s1-accent' : 'text-s1-muted'}`}>{tier.tier}</span>
                    </div>
                    {!base && (
                      <div className="flex items-center gap-2 py-2 pl-5 font-mono text-xs text-s1-muted">
                        <FontAwesomeIcon icon={faArrowDown} />
                        {a.tierLinks[i]}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="mt-5 text-sm leading-relaxed text-s1-muted">{a.tiersText}</p>
          </div>
        </section>

        <section className="mt-20 grid gap-16">
          <div className="min-w-0">
            <h2 className={H2}>{a.teamTitle}</h2>
            <p className="mt-2 text-s1-muted">{a.teamLead}</p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TEAM.map((member) => (
                <li key={member.name} className="flex items-center gap-3 rounded-xl border border-s1-line bg-s1-surface p-3">
                  <Avatar member={member} />
                  <span className="whitespace-nowrap font-medium">{member.name}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0">
            <h2 className={H2}>{a.partnersTitle}</h2>
            <p className="mt-2 text-s1-muted">{a.partnersLead}</p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PARTNERS.map((p) => (
                <li key={p.key}>
                  <a
                    href={p.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-4 rounded-xl border border-s1-line bg-s1-surface p-3 transition hover:border-s1-accent"
                  >
                    {/* Logos are drawn for white, so the tile stays white in dark mode. */}
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#fff] p-1.5">
                      <img src={p.logo} alt="" className="max-h-full max-w-full object-contain" />
                    </span>
                    <span className="font-medium">{a.partners[p.key]}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
