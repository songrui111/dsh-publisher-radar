/**
 * The topic taxonomy behind the keyword-gap ranking.
 *
 * Each topic is a lexical matcher over `name + description`. This is deliberately
 * a *lexical* signal, not a semantic one: the number it produces is "how many
 * catalog entries mention this subject", which is exactly what a publisher needs
 * to answer "is anyone already making this?". It over-counts (a description that
 * says "budget" for token budgets matches 记账) and therefore errs toward
 * "occupied" — a cell reported as empty is much more trustworthy than a cell
 * reported as crowded.
 *
 * Patterns are written with word boundaries or Chinese terms where a bare English
 * word would match inside unrelated words (`ats` inside `formats`, `option` inside
 * `options`). Where a topic cannot avoid that, the topic says so in `caveat`.
 */

/** @typedef {{ id: string, label: string, re: RegExp, caveat?: string }} Topic */

/** @type {Topic[]} */
export const TOPICS = [
  // --- productivity / office -------------------------------------------------
  { id: 'feishu', label: '飞书 / Lark', re: /飞书|\blark\b/i },
  { id: 'dingtalk', label: '钉钉', re: /钉钉|dingtalk/i },
  { id: 'wecom', label: '企业微信', re: /企业微信|\bwecom\b/i },
  { id: 'tencent-docs', label: '腾讯文档', re: /腾讯文档|tencent\s?docs/i },
  { id: 'yuque', label: '语雀', re: /语雀|\byuque\b/i },
  { id: 'notion', label: 'Notion', re: /\bnotion\b/i },
  { id: 'confluence', label: 'Confluence', re: /confluence/i },
  { id: 'jira', label: 'Jira', re: /\bjira\b/i },
  { id: 'linear', label: 'Linear', re: /\blinear\b/i },
  { id: 'asana', label: 'Asana', re: /\basana\b/i },
  { id: 'trello', label: 'Trello', re: /\btrello\b/i },
  { id: 'clickup', label: 'ClickUp', re: /clickup/i },
  { id: 'kanban', label: '看板 / Kanban', re: /看板|kanban|taskboard/i },
  { id: 'slack', label: 'Slack', re: /\bslack\b/i },
  { id: 'discord', label: 'Discord', re: /discord/i },
  { id: 'telegram', label: 'Telegram', re: /telegram/i },
  { id: 'mail', label: '邮件收发', re: /邮件|e-?mail|imap|smtp/i },
  { id: 'calendar', label: '日历', re: /日历|calendar|\bical\b/i, caveat: 'calendar 也会命中无关词' },
  { id: 'meeting', label: '会议 / 纪要', re: /会议纪要|会议记录|meeting notes|transcri/i },

  // --- engineering -----------------------------------------------------------
  { id: 'gitlab', label: 'GitLab', re: /gitlab/i },
  { id: 'gitee', label: 'Gitee', re: /\bgitee\b/i },
  { id: 'cnb', label: 'CNB', re: /\bcnb\b/i },
  { id: 'k8s', label: 'Kubernetes', re: /kubernetes|\bk8s\b|helm/i },
  { id: 'iac', label: 'Terraform / IaC', re: /terraform|ansible|infrastructure as code/i },
  { id: 'docker', label: 'Docker', re: /docker|容器编排/i },
  { id: 'lsp', label: 'LSP / 类型检查', re: /\blsp\b|language server|tsc --noemit/i },

  // --- data ------------------------------------------------------------------
  { id: 'db', label: 'SQL / 数据库', re: /\bsql\b|postgres|mysql|sqlite|mongodb|clickhouse|duckdb/i },
  { id: 'bi', label: 'BI / 指标口径', re: /tableau|power\s?bi|superset|metabase|looker|商业智能|\bbi\b/i },
  { id: 'viz', label: '图表 / 可视化', re: /图表|可视化|\bchart\b|echarts|plot/i },
  { id: 'pipeline', label: '数据管道', re: /airflow|\bdbt\b|kafka|数据管道|\betl\b/i },

  // --- finance ---------------------------------------------------------------
  { id: 'stock', label: '股票行情', re: /股票|行情|\bk线\b|港股|美股|\bstock\b|quote/i },
  { id: 'fund', label: '基金', re: /基金|\bfund\b/i },
  { id: 'futures', label: '期货 / 期权', re: /期货|期权|futures/i },
  { id: 'crypto', label: '加密 / Web3', re: /web3|on-?chain|区块链|以太坊|defi|\bbtc\b/i },
  { id: 'invoice', label: '发票 / 报销', re: /发票|报销|expense|receipt/i, caveat: 'receipt 也会命中工具回执' },
  { id: 'tax', label: '税务', re: /税务|报税|增值税|个税/i },

  // --- legal -----------------------------------------------------------------
  { id: 'law', label: '法规 / 判例', re: /法规|法条|判例|\blegal\b|case law/i },
  { id: 'contract', label: '合同审查', re: /合同|contract/i },
  { id: 'patent', label: '专利 / 商标', re: /专利|商标|patent|trademark/i },

  // --- science / health ------------------------------------------------------
  { id: 'paper', label: '论文 / 文献', re: /pubmed|文献|论文|arxiv|\bdoi\b/i },
  { id: 'latex', label: 'LaTeX / BibTeX', re: /latex|bibtex|\btex\b/i },
  { id: 'chem', label: '化学 / 分子', re: /化学|分子|\bsmiles\b|rdkit/i },
  { id: 'bio', label: '生物信息', re: /基因|基因组|蛋白|protein|bioinform/i },
  { id: 'medical', label: '病历 / 临床', re: /病历|临床|clinical|\behr\b/i },
  { id: 'dicom', label: '医学影像 / DICOM', re: /dicom|医学影像|\bpacs\b|放射科/i },

  // --- content ---------------------------------------------------------------
  { id: 'translate', label: '翻译', re: /翻译|translate|\bi18n\b/i },
  { id: 'subtitle', label: '字幕', re: /字幕|subtitle|\bsrt\b/i },
  { id: 'tts', label: '配音 / 语音合成', re: /配音|\btts\b|语音合成|voice clone/i },
  { id: 'video-edit', label: '视频剪辑', re: /视频剪辑|ffmpeg|剪辑/i },
  { id: 'image-gen', label: '图片生成', re: /文生图|图片生成|image gen|seedream|midjourney|stable diffusion/i },
  { id: 'music', label: '音乐', re: /音乐|\bmusic\b|\bmidi\b|作曲/i },
  { id: 'podcast', label: '播客', re: /播客|podcast/i },
  { id: 'xiaohongshu', label: '小红书', re: /小红书|xiaohongshu|rednote/i },
  { id: 'bilibili', label: 'B 站', re: /\bb站\b|bilibili/i },
  { id: 'wechat-mp', label: '公众号', re: /公众号|\bmp\.weixin\b/i },
  { id: 'zhihu', label: '知乎', re: /知乎|zhihu/i },
  { id: 'seo', label: 'SEO / GEO', re: /\bseo\b|\bgeo\b|\baeo\b|搜索优化|ai 可见性/i },

  // --- commerce / enterprise -------------------------------------------------
  { id: 'ecommerce', label: '电商', re: /电商|淘宝|京东|拼多多|shopify|amazon/i },
  { id: 'logistics', label: '物流 / 运单', re: /物流|运单|快递|waybill/i },
  { id: 'crm', label: 'CRM', re: /salesforce|hubspot|客户关系|\bcrm\b/i },
  { id: 'helpdesk', label: '客服工单', re: /helpdesk|zendesk|intercom|工单系统|客服坐席/i },
  { id: 'recruit', label: '招聘 / ATS', re: /招聘|简历筛选|人才库|applicant/i },
  { id: 'interview', label: '面试', re: /面试|interview/i },

  // --- design / media / hardware ---------------------------------------------
  { id: 'education', label: '教育 / 题库', re: /教育|题库|课程|背单词|考试|\bexam\b|\bquiz\b/i },
  { id: 'cad3d', label: '3D / CAD', re: /\b3d\b|建模|blender|\bcad\b|\bstl\b|模型渲染/i },
  { id: 'game', label: '游戏', re: /游戏|\bgame\b|steam|galgame|unity|godot/i },
  { id: 'hardware', label: '硬件 / 嵌入式 / 机器人', re: /嵌入式|单片机|esp32|arduino|stm32|\bfpga\b|固件|机器人|机械臂|\bros2?\b/i },
  { id: 'arvr', label: 'AR / VR', re: /增强现实|虚拟现实|vision ?pro|meta quest|\bvr\b|\bxr\b/i },

  // --- life ------------------------------------------------------------------
  { id: 'weather', label: '天气', re: /天气|weather/i },
  { id: 'maps', label: '地图 / 出行', re: /地图|导航|航班|酒店|\bhotel\b|\bmap\b/i },
  { id: 'smarthome', label: '智能家居', re: /智能家居|home assistant|homekit|\bmqtt\b/i },
  { id: 'health', label: '健康 / 运动', re: /健康档案|运动|健身|步数|workout|sleep/i },
  { id: 'recipe', label: '菜谱 / 外卖', re: /菜谱|食谱|外卖|recipe/i },

  // --- DSH platform-level ----------------------------------------------------
  { id: 'memory', label: '记忆', re: /记忆|memory/i },
  { id: 'mcp-manage', label: 'MCP 管理面板', re: /mcp (服务器|服务|server)|mcp 管理/i },
  { id: 'doctor', label: '诊断 / doctor', re: /诊断|doctor|体检|健康检查/i },
  { id: 'security-scan', label: '安全扫描', re: /安全扫描|风险分|恶意|投毒|漏洞扫描/i },
  { id: 'billing', label: '账单 / 用量', re: /余额|计费|账单|token 用量|花费/i },
  { id: 'theme', label: '主题 / 皮肤', re: /主题|皮肤|theme|壁纸|wallpaper/i },
  { id: 'remote', label: '远程 / 移动端', re: /远程访问|手机|移动端|pwa|隧道|tunnel/i },
];

/** Everything a matcher looks at. */
export function haystack(entry) {
  const d = typeof entry.description === 'string'
    ? entry.description
    : entry.description && typeof entry.description === 'object'
      ? [entry.description.zh, entry.description.en].filter(Boolean).join(' ')
      : '';
  return `${entry.name ?? ''} ${entry.owner ?? ''} ${d}`;
}

/** How a count turns into a verdict a publisher can act on. */
export function levelOf(count) {
  if (count === 0) return 'empty';
  if (count <= 3) return 'thin';
  if (count <= 10) return 'warming';
  return 'crowded';
}

/**
 * Count every topic across the catalog.
 *
 * @param entries Normalized catalog entries.
 * @param topics  Override for tests.
 * @returns Rows sorted emptiest first, with up to three exemplar plugin names.
 */
export function gapIndex(entries, topics = TOPICS) {
  const rows = topics.map((topic) => {
    const hits = [];
    for (const entry of entries) {
      if (topic.re.test(haystack(entry))) hits.push(entry);
    }
    return {
      id: topic.id,
      label: topic.label,
      caveat: topic.caveat ?? null,
      count: hits.length,
      level: levelOf(hits.length),
      samples: hits.slice(0, 3).map((h) => h.name),
    };
  });
  const order = { empty: 0, thin: 1, warming: 2, crowded: 3 };
  rows.sort((a, b) => order[a.level] - order[b.level] || a.count - b.count || a.label.localeCompare(b.label));
  return rows;
}

/** Topics whose id matches a free-text query (for `radar_plugin --topic`). */
export function findTopics(query) {
  const q = String(query ?? '').toLowerCase().trim();
  if (q === '') return [];
  return TOPICS.filter((t) => t.id.includes(q) || t.label.toLowerCase().includes(q));
}
