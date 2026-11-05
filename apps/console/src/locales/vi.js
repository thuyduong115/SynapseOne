// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 VKU.VIC
/*
 * Copyright 2026 SynapseOne Contributors
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
// Vietnamese copy (default language). en.js keeps exactly the same keys.

export const vi = {
  meta: {
    title: 'SynapseOne Console · Nền tảng PaaS mở',
    description:
      'SynapseOne là nền tảng PaaS Tầng 1 mã nguồn mở (Apache-2.0): cổng API, IAM kiểu AWS, cụm dữ liệu lõi và quy trình, quản lý qua Console, SDK đa ngôn ngữ và CLI.',
  },

  nav: {
    home: 'Trang chủ',
    apiDocs: 'Tài liệu API',
    docs: 'Hướng dẫn',
    about: 'Giới thiệu',
    signIn: 'Đăng nhập',
    console: 'Console',
    openConsole: 'Mở Console',
    switchLang: 'Switch to English',
    langShort: 'EN',
    theme: { light: 'Giao diện sáng', dark: 'Giao diện tối', system: 'Theo hệ thống' },
    openMenu: 'Mở menu',
    closeMenu: 'Đóng menu',
  },

  footer: {
    tagline: 'Nền tảng PaaS Tầng 1 mã nguồn mở.',
    product: 'Sản phẩm',
    project: 'Dự án',
    support: 'Hỗ trợ',
    licenses: 'Giấy phép',
    links: {
      console: 'Console',
      apiDocs: 'Tài liệu API',
      docs: 'Hướng dẫn',
      about: 'Giới thiệu',
      repo: 'Mã nguồn',
      releases: 'Phiên bản phát hành',
      changelog: 'Nhật ký thay đổi',
      npm: 'SDK trên npm',
      pypi: 'SDK trên PyPI',
      build: 'Hướng dẫn cài đặt',
      issues: 'Báo lỗi',
      contributing: 'Đóng góp mã',
      source: 'Mã nguồn: Apache-2.0',
      thirdParty: 'Thư viện bên thứ ba',
    },
    bottom: '© 2026 synapseone · Apache-2.0 · PaaS Tầng 1',
  },

  landing: {
    titleBefore: 'Nền tảng PaaS',
    titleHighlight: 'mở',
    titleAfter: 'cho hạ tầng của bạn',
    lead:
      'SynapseOne là nền tảng PaaS Tầng 1 mã nguồn mở (Apache-2.0): cổng API, IAM kiểu AWS, cụm dữ liệu lõi và quy trình, quản lý qua Console, SDK đa ngôn ngữ và CLI.',
    openConsole: 'Trải nghiệm ngay',
    exploreApi: 'Tài liệu API',
    cliTitle: 'Cài đặt CLI',
    cliText: 'Một dòng lệnh, không cần clone mã nguồn, hoặc chạy ngay bằng npx (Node 18+).',
    cliComment: '# ..hoặc không cần cài gì:',
    selfHostTitle: 'Tự triển khai với 3 lệnh',
    selfHostEnv: '# sau đó thay mọi secret *_change_me_*',
    selfHostLogin: '# đăng nhập: demo@acme.local / tổ chức acme',
    featuresHeading: 'Thành phần nền tảng',
    features: [
      {
        title: 'IAM kiểu AWS',
        text: 'Tổ chức → Tài khoản → Người dùng → Vai trò → Chính sách JSON (Allow/Deny, Condition), authorize, trình mô phỏng và nhật ký kiểm toán.',
      },
      {
        title: 'Token linh hoạt',
        text: 'JWT ngắn hạn, refresh token xoay vòng nguyên tử, khóa API, tài khoản dịch vụ, OIDC qua Authentik/Keycloak.',
      },
      {
        title: 'Cổng API',
        text: 'Một điểm vào duy nhất: xác thực, giới hạn tần suất tại biên, truyền danh tính, tracing, /ready tổng hợp.',
      },
      {
        title: 'Cụm dữ liệu lõi',
        text: 'Postgres, Redis và lưu trữ tương thích S3, schema có phiên bản, seed idempotent, sao lưu và khôi phục.',
      },
      {
        title: 'Quy trình',
        text: 'Engine cục bộ: mẫu có phiên bản, code chạy trong sandbox, kích hoạt/thực thi, webhook và cron, trình soạn thảo định nghĩa.',
      },
      {
        title: 'Trợ lý AI và SDK',
        text: 'Chatbot trên trang Tài liệu API điền sẵn form thử nghiệm. JS/TS, Python, Go, CLI không phụ thuộc và Console quản trị dùng chung một API.',
      },
    ],
  },

  about: {
    kicker: 'Giới thiệu',
    title: 'SynapseOne, nền tảng PaaS Tầng 1 mở',
    intro:
      'SynapseOne là nền tảng Apache-2.0 cung cấp cho sản phẩm một API duy nhất cho định danh, phân quyền, dữ liệu, quy trình, sự kiện, tệp, thông báo và AI. Nền tảng do nhóm VKU.VIC xây dựng và được thiết kế để các tầng trên sử dụng: năng lực SynapseDX và các sản phẩm quy mô đô thị dùng chung cổng HTTPS công khai.',
    featuresHeading: 'Tính năng',
    features: [
      {
        title: 'IAM kiểu AWS',
        text: 'Tổ chức → Tài khoản → Người dùng → Vai trò → Chính sách JSON, scope áp dụng theo từng route, trình mô phỏng authorize và nhật ký mọi thay đổi.',
      },
      {
        title: 'Định danh',
        text: 'Vòng đời mật khẩu, refresh token xoay vòng, khóa API, tài khoản dịch vụ, đổi token ủy quyền cho người dùng và SSO qua OIDC.',
      },
      {
        title: 'Cổng API',
        text: 'Một điểm vào công khai với xác thực JWT/khóa API, giới hạn theo client, truyền danh tính, tracing và kiểm tra sẵn sàng tổng hợp.',
      },
      {
        title: 'Tầng dữ liệu',
        text: 'Postgres, Redis, lưu trữ đối tượng theo tenant, CSDL tài liệu, cache/KV, hàng đợi và luồng sự kiện, tất cả sau cùng một API.',
      },
      {
        title: 'Quy trình',
        text: 'Engine DAG tích hợp: mẫu có phiên bản, code chạy trong sandbox, webhook, trigger cron, lịch sử thực thi và trình soạn thảo trực quan.',
      },
      {
        title: 'AI và client',
        text: 'Suy luận có streaming và đo token, gửi thông báo, SDK TypeScript/Python/Go, CLI và Console này.',
      },
    ],
    openSourceTitle: 'Mã nguồn mở',
    openSourceText:
      'Toàn bộ mã nền tảng theo Apache-2.0, có header SPDX trong từng tệp nguồn và ghi nhận thư viện bên thứ ba. Đóng góp tuân theo CODE_OF_CONDUCT và GOVERNANCE của kho mã.',
    links: {
      repo: 'Kho mã GitHub',
      docs: 'Tài liệu',
      api: 'Tham chiếu API',
      npm: 'SDK trên npm',
      pypi: 'SDK trên PyPI',
      license: 'Giấy phép (Apache-2.0)',
    },
    tiersTitle: 'Các tầng kết nối thế nào',
    tierStack: [
      { name: 'SynapseCity / SynapseCitySOS', tier: 'Tầng 3' },
      { name: 'API/SDK năng lực SynapseDX', tier: 'Tầng 2' },
      { name: 'SynapseOne', tier: 'Tầng 1' },
    ],
    tierLinks: ['HTTPS công khai', '@synapseone/sdk'],
    tiersText:
      'Tầng 2 ủy quyền định danh người dùng qua endpoint đổi token và lưu dữ liệu qua các năng lực dữ liệu của Tầng 1. Tầng 2 và Tầng 3 không bao giờ dùng chung cơ sở dữ liệu hay cổng dịch vụ với Tầng 1.',
    teamTitle: 'Đội ngũ',
    teamLead: 'Những người xây dựng và duy trì SynapseOne (VKU.VIC)',
    partnersTitle: 'Đơn vị đồng hành',
    partnersLead: 'Nhận được sự ủng hộ từ các tổ chức tin tưởng vào mã nguồn mở',
    partners: { vku: 'Đại học VKU', vic: 'CLB IT VKU' },
  },

  login: {
    title: 'SynapseOne Console',
    sub: 'Quản trị PaaS Tầng 1 · Cổng API',
    modeEmail: 'Email (dev/OIDC)',
    modeKey: 'Khóa API',
    email: 'Email',
    org: 'Mã tổ chức',
    apiKey: 'X-API-Key (synapseone_...)',
    submit: 'Đăng nhập',
    or: 'hoặc',
    sso: 'Tiếp tục với SSO',
    redirecting: 'Đang chuyển hướng…',
    mfaCode: 'Mã xác thực',
    recoveryCode: 'Mã khôi phục',
    verify: 'Xác minh',
    useRecovery: 'Dùng mã khôi phục',
    useAuthenticator: 'Dùng mã xác thực',
    back: 'Quay lại',
    note: 'Đăng nhập bằng email dành cho môi trường phát triển. Môi trường thật dùng SSO (Authentik/Keycloak) hoặc khóa API.',
    enterKey: 'Hãy nhập khóa API',
    ssoMissing: 'Chưa cấu hình SSO (máy chủ không trả về authorizeUrl)',
    about: 'Giới thiệu synapseone',
  },

  console: {
    title: 'SynapseOne Console',
    core: 'Nền tảng lõi',
    docsSection: 'Tài liệu',
    docsApis: 'Tài liệu & API',
    servicesSection: 'Dịch vụ nền tảng',
    footer: 'PaaS Tầng 1 · Apache-2.0',
    nav: {
      dashboard: 'Tổng quan',
      orgs: 'Tổ chức',
      accounts: 'Tài khoản',
      users: 'Người dùng',
      roles: 'Vai trò',
      policies: 'Chính sách',
      keys: 'Khóa API',
      serviceAccounts: 'Tài khoản dịch vụ',
      authorize: 'Kiểm tra quyền',
      audit: 'Nhật ký kiểm toán',
      security: 'Bảo mật',
      apiDocs: 'Tài liệu API',
      docs: 'Hướng dẫn',
    },
    services: 'Dịch vụ',
    showServices: 'Hiện thanh dịch vụ',
    hideServices: 'Ẩn thanh dịch vụ',
    collapseServices: 'Thu gọn thanh dịch vụ',
    active: 'đang chạy',
    searchServices: 'Tìm dịch vụ...',
    noServices: 'Không có dịch vụ nào khớp',
    clearSearch: 'Xóa tìm kiếm',
    servicesFooter: 'Tầng 1 phân tán',
    org: 'Tổ chức',
    orgPick: 'Tổ chức…',
    account: 'Tài khoản',
    accountPick: 'Tài khoản…',
    signOut: 'Đăng xuất',
    signOutAll: 'Đăng xuất mọi phiên',
    apiKeySession: 'Khóa API ••••',
  },

  services: {
    workflows: { category: 'Tự động hóa & tác tử AI', desc: 'Pipeline trực quan, tác tử AI, định tuyến quyết định và DAG' },
    base: { category: 'CSDL tài liệu', desc: 'Tài liệu JSON, ánh xạ đối tượng ↔ dữ liệu và truy vấn' },
    queue: { category: 'Hàng đợi tin nhắn', desc: 'Hàng đợi giao ít nhất một lần, lease và dead letter' },
    stream: { category: 'Luồng sự kiện', desc: 'Nhật ký sự kiện phân tán, consumer group và phát lại theo thời gian' },
    ocs: { category: 'Lưu trữ đối tượng', desc: 'Bucket, object, URL ký sẵn, tải lên nhiều phần và hạn mức tenant' },
    faststore: { category: 'Cache & KV', desc: 'Cache trên Redis, bộ đếm, hash và khóa phân tán' },
    lds: { category: 'Dữ liệu liên kết', desc: 'Nguồn dữ liệu NGSI-LD, schema thực thể và giấy phép dữ liệu mở' },
    inference: { category: 'AI & suy luận', desc: 'Proxy LLM, embedding cục bộ và định tuyến Decision-2.0' },
  },
};
