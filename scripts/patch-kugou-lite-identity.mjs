// 身份硬切：把酷狗 API submodule 里的身份判断从「运行时读 process.env.platform」
// 固化为「纯概念版（lite）」。
//
// 背景：App 是纯概念版第三方客户端，用户领的是概念版会员。原代码靠运行期
// process.env.platform='lite' 切换身份，但 api/util/index.js 等在模块加载时就把
// isLite 固化成顶层常量，加载顺序一旦错就锁死主版身份（appid 1005），导致
// 概念版会员权益取链失败、大批量歌曲无音源。
//
// api/ 是 git submodule（MakcRe/KuGouMusicApi），改动无法随主仓库推送/构建，
// 因此必须在 CI checkout submodule 之后用本脚本就地打 patch。
// 幂等：重复执行不会重复插入或破坏代码。

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const apiDir = path.join(rootDir, 'api');

const OLD_EXPR = "process.env.platform === 'lite'";
const NEW_EXPR = 'true';

// 需要替换身份判断的文件（相对 api/）
const identityFiles = [
  'util/index.js',
  'util/request.js',
  'util/crypto.js',
  'util/helper.js',
  'module/song_url.js',
];

// helper.js 的默认 appid/clientver 取自主版 config.appid(1005)/clientver(20489)，
// 即使 isLite=true，回退分支仍可能用到主版值。统一改为 lite 值。
const helperDefaultOld =
  "const { appid: useAppid, liteAppid, clientver: useClientver, liteClientver } = require('./config.json');";
const helperDefaultNew =
  "const { liteAppid, liteClientver } = require('./config.json');\nconst useAppid = liteAppid;\nconst useClientver = liteClientver;";

async function patchFile(relPath) {
  const filePath = path.join(apiDir, relPath);
  let source;
  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    console.error(`[patch-kugou-lite] 读取失败 ${relPath}: ${error.message}`);
    throw error;
  }

  let next = source;
  const count = next.split(OLD_EXPR).length - 1;
  if (count > 0) {
    next = next.split(OLD_EXPR).join(NEW_EXPR);
  }

  if (relPath === 'util/helper.js' && next.includes(helperDefaultOld)) {
    next = next.replace(helperDefaultOld, helperDefaultNew);
  }

  if (next !== source) {
    await fs.writeFile(filePath, next, 'utf8');
    console.log(`[patch-kugou-lite] ${relPath}: 替换 ${count} 处身份判断`);
  } else {
    console.log(`[patch-kugou-lite] ${relPath}: 无需改动（已 patch 或结构变化）`);
  }
}

for (const rel of identityFiles) {
  await patchFile(rel);
}

// 校验：所有身份判断都应为 true，不应再有 process.env.platform === 'lite'
let leftover = 0;
for (const rel of identityFiles) {
  const source = await fs.readFile(path.join(apiDir, rel), 'utf8');
  if (source.includes(OLD_EXPR)) {
    console.error(`[patch-kugou-lite] 警告：${rel} 仍有未替换的身份判断`);
    leftover += 1;
  }
}
if (leftover > 0) {
  console.error('[patch-kugou-lite] patch 未完全生效');
  process.exitCode = 1;
} else {
  console.log('[patch-kugou-lite] 完成：身份已锁定为概念版（lite）');
}
