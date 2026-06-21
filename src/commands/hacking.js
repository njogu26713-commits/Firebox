const crypto = require('crypto');
const dns = require('dns').promises;
const axios = require('axios');
const { openRouterPrompt } = require('../openrouter');
const { parsePhoneNumber, isValidPhoneNumber, getNumberType, PhoneNumberType } = require('libphonenumber-js');

async function send(sock, from, msg, text) {
  const lines = text.split('\n');
  if (/\*[^*\n]+\*/.test(lines[0])) lines[0] = '> ' + lines[0];
  await sock.sendMessage(from, { text: lines.join('\n') }, { quoted: msg });
}

// ── PASSWORD STRENGTH CHECKER ─────────────────────────────────────────────────
async function checkpass(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔐 *Usage:* .checkpass <password>\nExample: .checkpass MyP@ss123');

  const p = text;
  let score = 0;
  const checks = {
    '8+ characters':       p.length >= 8,
    '12+ characters':      p.length >= 12,
    'Uppercase letter':    /[A-Z]/.test(p),
    'Lowercase letter':    /[a-z]/.test(p),
    'Number':              /[0-9]/.test(p),
    'Special character':   /[^A-Za-z0-9]/.test(p),
    'Not common pattern':  !/^(password|123456|qwerty|abc123|letmein|admin|welcome)/i.test(p),
  };

  for (const ok of Object.values(checks)) if (ok) score++;

  const maxScore = Object.keys(checks).length;
  const percent = Math.round((score / maxScore) * 100);
  const bar = '█'.repeat(Math.round(percent / 10)) + '░'.repeat(10 - Math.round(percent / 10));

  const strength =
    percent >= 85 ? '💚 *Very Strong*' :
    percent >= 65 ? '🟡 *Strong*' :
    percent >= 45 ? '🟠 *Moderate*' :
    percent >= 25 ? '🔴 *Weak*' :
                    '💀 *Very Weak*';

  const lines = Object.entries(checks).map(([k, v]) => `${v ? '✅' : '❌'} ${k}`).join('\n');

  await send(sock, from, msg,
    `🔐 *Password Strength Checker*\n\n` +
    `🔑 Password: \`${'*'.repeat(p.length)}\`\n` +
    `📊 Score: [${bar}] ${percent}%\n` +
    `💪 Strength: ${strength}\n\n` +
    `*Checklist:*\n${lines}\n\n` +
    `_Tip: Use a mix of upper, lower, numbers & symbols for max security._`);
}

// ── HASH GENERATOR ────────────────────────────────────────────────────────────
async function hash(ctx) {
  const { sock, from, msg, args, text } = ctx;
  const algos = ['md5', 'sha1', 'sha256', 'sha512'];
  const algo = args[0]?.toLowerCase();
  const input = args.slice(1).join(' ');

  if (!algo || !algos.includes(algo) || !input) {
    return send(sock, from, msg,
      `#️⃣ *Hash Generator*\n\n` +
      `*Usage:* .hash <algorithm> <text>\n\n` +
      `*Algorithms:*\n• md5\n• sha1\n• sha256\n• sha512\n\n` +
      `*Example:* .hash sha256 hello world`);
  }

  const result = crypto.createHash(algo).update(input).digest('hex');
  await send(sock, from, msg,
    `#️⃣ *Hash Generator*\n\n` +
    `📝 Input: \`${input}\`\n` +
    `⚙️ Algorithm: *${algo.toUpperCase()}*\n\n` +
    `🔐 Hash:\n\`${result}\``);
}

// ── BASE64 ENCODE / DECODE ────────────────────────────────────────────────────
async function b64encode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📦 *Usage:* .b64encode <text>');
  const encoded = Buffer.from(text).toString('base64');
  await send(sock, from, msg,
    `📦 *Base64 Encode*\n\n` +
    `📝 Input: \`${text}\`\n\n` +
    `🔐 Encoded:\n\`${encoded}\``);
}

async function b64decode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '📦 *Usage:* .b64decode <encoded text>');
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    await send(sock, from, msg,
      `📦 *Base64 Decode*\n\n` +
      `🔐 Input: \`${text}\`\n\n` +
      `📝 Decoded:\n\`${decoded}\``);
  } catch {
    await send(sock, from, msg, '❌ Invalid Base64 string.');
  }
}

// ── HEX ENCODE / DECODE ───────────────────────────────────────────────────────
async function hexencode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔢 *Usage:* .hexencode <text>');
  const encoded = Buffer.from(text).toString('hex');
  await send(sock, from, msg,
    `🔢 *Hex Encode*\n\n` +
    `📝 Input: \`${text}\`\n\n` +
    `🔐 Hex:\n\`${encoded}\``);
}

async function hexdecode(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🔢 *Usage:* .hexdecode <hex string>');
  try {
    const decoded = Buffer.from(text.replace(/\s/g, ''), 'hex').toString('utf8');
    await send(sock, from, msg,
      `🔢 *Hex Decode*\n\n` +
      `🔐 Input: \`${text}\`\n\n` +
      `📝 Decoded:\n\`${decoded}\``);
  } catch {
    await send(sock, from, msg, '❌ Invalid hex string.');
  }
}

// ── IP LOOKUP ─────────────────────────────────────────────────────────────────
async function iplookup(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg, '🌐 *Usage:* .iplookup <IP address>\nExample: .iplookup 8.8.8.8');

  const ip = text.trim();
  try {
    const { data } = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,query,mobile,proxy,hosting`, { timeout: 8000 });
    if (data.status !== 'success') return send(sock, from, msg, `❌ ${data.message || 'IP not found.'}`);

    await send(sock, from, msg,
      `🌐 *IP Lookup: ${data.query}*\n\n` +
      `🗺️ Country: ${data.country} ${data.countryCode ? `(${data.countryCode})` : ''}\n` +
      `🏙️ Region: ${data.regionName}\n` +
      `🌆 City: ${data.city}\n` +
      `📮 ZIP: ${data.zip || 'N/A'}\n` +
      `📍 Coords: ${data.lat}, ${data.lon}\n` +
      `🕐 Timezone: ${data.timezone}\n` +
      `🏢 ISP: ${data.isp}\n` +
      `🏛️ Org: ${data.org || 'N/A'}\n` +
      `📡 AS: ${data.as || 'N/A'}\n` +
      `📱 Mobile: ${data.mobile ? 'Yes' : 'No'}\n` +
      `🕵️ Proxy/VPN: ${data.proxy ? 'Yes ⚠️' : 'No'}\n` +
      `🖥️ Hosting/DC: ${data.hosting ? 'Yes' : 'No'}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to lookup IP: ${err.message}`);
  }
}

// ── DNS LOOKUP ────────────────────────────────────────────────────────────────
async function dnslookup(ctx) {
  const { sock, from, msg, args } = ctx;
  const domain = args[0];
  if (!domain) return send(sock, from, msg, '🔎 *Usage:* .dns <domain>\nExample: .dns google.com');

  try {
    const [a, mx, txt, ns] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolveMx(domain),
      dns.resolveTxt(domain),
      dns.resolveNs(domain),
    ]);

    const aRecords   = a.status   === 'fulfilled' ? a.value.join('\n  ') : 'None';
    const mxRecords  = mx.status  === 'fulfilled' ? mx.value.map(r => `${r.exchange} (${r.priority})`).join('\n  ') : 'None';
    const nsRecords  = ns.status  === 'fulfilled' ? ns.value.join('\n  ') : 'None';
    const txtRecords = txt.status === 'fulfilled' ? txt.value.map(r => r.join('')).slice(0, 3).join('\n  ') : 'None';

    await send(sock, from, msg,
      `🔎 *DNS Lookup: ${domain}*\n\n` +
      `📌 *A Records (IPv4):*\n  ${aRecords}\n\n` +
      `📬 *MX Records (Mail):*\n  ${mxRecords}\n\n` +
      `🏷️ *NS Records (Nameservers):*\n  ${nsRecords}\n\n` +
      `📝 *TXT Records:*\n  ${txtRecords}`);
  } catch (err) {
    await send(sock, from, msg, `❌ DNS lookup failed: ${err.message}`);
  }
}

// ── WHOIS LOOKUP ──────────────────────────────────────────────────────────────
async function whois(ctx) {
  const { sock, from, msg, args } = ctx;
  const domain = args[0];
  if (!domain) return send(sock, from, msg, '📋 *Usage:* .whois <domain>\nExample: .whois google.com');

  try {
    const { data } = await axios.get(`https://api.whois.vu/?q=${encodeURIComponent(domain)}`, { timeout: 10000 });
    const raw = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const trimmed = raw.length > 1500 ? raw.slice(0, 1500) + '\n...(truncated)' : raw;
    await send(sock, from, msg, `📋 *WHOIS: ${domain}*\n\n\`\`\`\n${trimmed}\n\`\`\``);
  } catch (err) {
    await send(sock, from, msg, `❌ WHOIS lookup failed: ${err.message}`);
  }
}

// ── PORT INFO ─────────────────────────────────────────────────────────────────
const PORT_DB = {
  21: 'FTP — File Transfer Protocol (unencrypted)',
  22: 'SSH — Secure Shell (encrypted remote access)',
  23: 'Telnet — Unencrypted remote terminal',
  25: 'SMTP — Email sending',
  53: 'DNS — Domain Name System',
  80: 'HTTP — Unencrypted web traffic',
  110: 'POP3 — Email retrieval',
  143: 'IMAP — Email access',
  443: 'HTTPS — Encrypted web traffic',
  445: 'SMB — Windows file sharing (common attack target)',
  3306: 'MySQL — Database server',
  3389: 'RDP — Remote Desktop Protocol',
  5432: 'PostgreSQL — Database server',
  5900: 'VNC — Remote desktop',
  6379: 'Redis — In-memory data store',
  8080: 'HTTP Alternate — Often used for proxies or dev servers',
  8443: 'HTTPS Alternate',
  27017: 'MongoDB — NoSQL database',
};

async function portinfo(ctx) {
  const { sock, from, msg, args } = ctx;
  const port = parseInt(args[0]);

  if (!args[0]) {
    const list = Object.entries(PORT_DB).map(([p, d]) => `• *${p}* — ${d}`).join('\n');
    return send(sock, from, msg, `🔌 *Common Port Reference*\n\n${list}\n\n_Usage: .portinfo <port number>_`);
  }

  if (isNaN(port) || port < 1 || port > 65535) {
    return send(sock, from, msg, '❌ Invalid port. Must be between 1 and 65535.');
  }

  const info = PORT_DB[port];
  await send(sock, from, msg,
    `🔌 *Port ${port} Info*\n\n` +
    (info
      ? `📋 Service: ${info}\n\n_This is a well-known port often targeted in security audits._`
      : `⚠️ Port ${port} is not in our common ports database.\n\n_It may be a custom/proprietary service. Check documentation or use a port scanner tool for more details._`));
}

// ── CIPHER (ROT13 / Caesar) ───────────────────────────────────────────────────
async function cipher(ctx) {
  const { sock, from, msg, args } = ctx;
  const mode = args[0]?.toLowerCase();
  const shift = parseInt(args[1]);
  const input = args.slice(2).join(' ');

  if (!['encode', 'decode'].includes(mode) || isNaN(shift) || !input) {
    return send(sock, from, msg,
      `🔄 *Caesar Cipher*\n\n` +
      `*Usage:* .cipher encode/decode <shift> <text>\n\n` +
      `*Example:*\n• .cipher encode 13 Hello World\n• .cipher decode 13 Uryyb Jbeyq`);
  }

  const n = mode === 'decode' ? (26 - (shift % 26)) % 26 : shift % 26;
  const result = input.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26) + base);
  });

  await send(sock, from, msg,
    `🔄 *Caesar Cipher (Shift ${shift})*\n\n` +
    `📝 Input: \`${input}\`\n` +
    `⚙️ Mode: ${mode}\n\n` +
    `🔐 Result:\n\`${result}\``);
}

// ── NUMBER LOCATION LOOKUP ────────────────────────────────────────────────────
const NUMBER_TYPE_LABELS = {
  MOBILE:           '📱 Mobile',
  FIXED_LINE:       '☎️ Fixed Line',
  FIXED_LINE_OR_MOBILE: '📞 Fixed/Mobile',
  TOLL_FREE:        '🆓 Toll Free',
  PREMIUM_RATE:     '💰 Premium Rate',
  SHARED_COST:      '💱 Shared Cost',
  VOIP:             '🌐 VoIP',
  PERSONAL_NUMBER:  '👤 Personal',
  PAGER:            '📟 Pager',
  UAN:              '🏢 UAN',
  VOICEMAIL:        '📬 Voicemail',
  UNKNOWN:          '❓ Unknown',
};

async function numlookup(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg,
    `📍 *Number Location Lookup*\n\n` +
    `*Usage:* .numlookup <number with country code>\n\n` +
    `*Examples:*\n• .numlookup +254712345678\n• .numlookup +447911123456\n• .numlookup +12025551234\n\n` +
    `_Always include the + and country code_`);

  const raw = text.trim().replace(/\s+/g, '');
  const withPlus = raw.startsWith('+') ? raw : '+' + raw;

  try {
    let parsed;
    try {
      parsed = parsePhoneNumber(withPlus);
    } catch {
      return send(sock, from, msg, `❌ Invalid phone number. Make sure to include the country code.\n\n*Example:* .numlookup +254712345678`);
    }

    const valid = isValidPhoneNumber(withPlus);
    const typeKey = PhoneNumberType ? Object.keys(PhoneNumberType).find(k => PhoneNumberType[k] === getNumberType(parsed)) : 'UNKNOWN';
    const typeLabel = NUMBER_TYPE_LABELS[typeKey] || '❓ Unknown';

    const country = parsed.country || 'Unknown';
    const countryCallingCode = parsed.countryCallingCode;
    const nationalNumber = parsed.nationalNumber;
    const formatted = parsed.formatInternational();
    const uri = parsed.getURI();

    // Get extra country info via IP-API country endpoint
    let countryInfo = '';
    try {
      const { data } = await axios.get(
        `https://restcountries.com/v3.1/alpha/${country}?fields=name,capital,region,subregion,timezones,flags,currencies,languages`,
        { timeout: 6000 }
      );
      const name     = data.name?.common || country;
      const capital  = data.capital?.[0] || 'N/A';
      const region   = data.subregion || data.region || 'N/A';
      const tz       = data.timezones?.[0] || 'N/A';
      const currency = Object.values(data.currencies || {})[0];
      const currStr  = currency ? `${currency.name} (${currency.symbol})` : 'N/A';
      const lang     = Object.values(data.languages || {})[0] || 'N/A';

      countryInfo =
        `\n🗺️ Region: ${region}` +
        `\n🏙️ Capital: ${capital}` +
        `\n🕐 Timezone: ${tz}` +
        `\n💰 Currency: ${currStr}` +
        `\n🗣️ Language: ${lang}`;
    } catch { }

    await send(sock, from, msg,
      `📍 *Number Location Lookup*\n\n` +
      `📞 Number: *${formatted}*\n` +
      `${valid ? '✅ Valid number' : '⚠️ Possibly invalid number'}\n\n` +
      `🌍 Country: *${country}*\n` +
      `🔢 Country Code: +${countryCallingCode}\n` +
      `📋 National Number: ${nationalNumber}\n` +
      `📡 Type: ${typeLabel}` +
      countryInfo +
      `\n\n_Note: This shows info based on the number prefix only. Exact GPS location cannot be determined from a phone number._`);
  } catch (err) {
    await send(sock, from, msg, `❌ Lookup failed: ${err.message}`);
  }
}

// ── SCAM / PHISHING ANALYZER ──────────────────────────────────────────────────
async function scamalyze(ctx) {
  const { sock, from, msg, text } = ctx;

  // Also support replying to a message
  const quotedText = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation
    || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text;

  const input = text || quotedText;

  if (!input) {
    return send(sock, from, msg,
      `🕵️ *Scam Analyzer*\n\n` +
      `*Usage:*\n• .scamalyze <message or link>\n• Reply to a suspicious message with .scamalyze\n\n` +
      `*Examples:*\n• .scamalyze You have won $1,000,000! Click here: bit.ly/win-now\n• .scamalyze Congratulations! Your account needs verification at paypa1.com`);
  }

  try {
    await sock.sendPresenceUpdate('composing', from);

    const prompt = `You are a cybersecurity expert specializing in scam and phishing detection. Analyze the following message or URL and provide a structured scam analysis report.

MESSAGE TO ANALYZE:
"${input}"

Respond ONLY with this exact format (fill in each section):

🎯 VERDICT: [SCAM / LIKELY SCAM / SUSPICIOUS / LIKELY SAFE / SAFE]
⚠️ RISK LEVEL: [CRITICAL / HIGH / MEDIUM / LOW / NONE]
🔥 CONFIDENCE: [0-100]%

🚩 RED FLAGS FOUND:
[List each red flag as a bullet point, or "None detected" if safe]

🔍 ANALYSIS:
[2-3 sentence plain-English explanation of why this is or isn't a scam]

💡 WHAT TO DO:
[1-2 clear action steps the user should take]

🛡️ SCAM TYPE:
[e.g. Phishing / Advance Fee / Lottery Scam / Fake Giveaway / Credential Harvesting / Malware Link / Impersonation / None]`;

    const analysis = await openRouterPrompt(prompt);
    await send(sock, from, msg, `🕵️ *Scam Analysis Report*\n\n${analysis}\n\n_Powered by Firebox AI_`);
  } catch (err) {
    await send(sock, from, msg, `❌ Analysis failed: ${err.message}`);
  }
}

// ── SSL CERTIFICATE CHECKER ───────────────────────────────────────────────────
async function sslcheck(ctx) {
  const { sock, from, msg, args } = ctx;
  const domain = args[0]?.replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) return send(sock, from, msg, '🔒 *Usage:* .sslcheck <domain>\nExample: .sslcheck google.com');

  try {
    const { data } = await axios.get(`https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&fromCache=on&maxAge=24`, { timeout: 12000 });
    const grade = data.endpoints?.[0]?.grade || 'N/A';
    const statusMsg = data.statusMessage || data.status || 'Unknown';

    let gradeEmoji = '❓';
    if (grade.startsWith('A')) gradeEmoji = '💚';
    else if (grade.startsWith('B')) gradeEmoji = '🟡';
    else if (grade.startsWith('C')) gradeEmoji = '🟠';
    else if (['D','E','F','T','M'].includes(grade[0])) gradeEmoji = '🔴';

    if (data.status === 'DNS') return send(sock, from, msg, `🔒 *SSL Check: ${domain}*\n\n⏳ Analysis in progress, please try again in ~30 seconds.`);
    if (data.status === 'ERROR') return send(sock, from, msg, `❌ SSL check failed for *${domain}*: ${statusMsg}`);

    const ep = data.endpoints?.[0];
    await send(sock, from, msg,
      `🔒 *SSL Certificate Check*\n\n` +
      `🌐 Domain: *${domain}*\n` +
      `${gradeEmoji} Grade: *${grade}*\n` +
      `📊 Status: ${statusMsg}\n` +
      `🖥️ Server: ${ep?.serverName || 'N/A'}\n` +
      `📍 IP: ${ep?.ipAddress || 'N/A'}\n\n` +
      `_Grade A = excellent SSL config, F = critically broken_`);
  } catch (err) {
    await send(sock, from, msg, `❌ SSL check failed: ${err.message}`);
  }
}

// ── HTTP SECURITY HEADERS SCANNER ─────────────────────────────────────────────
async function headers(ctx) {
  const { sock, from, msg, args } = ctx;
  let url = args[0];
  if (!url) return send(sock, from, msg, '🛡️ *Usage:* .headers <url>\nExample: .headers https://google.com');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const res = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0 (SecurityHeadersChecker)' }
    });

    const h = res.headers;
    const checks = {
      'Strict-Transport-Security (HSTS)': h['strict-transport-security'],
      'Content-Security-Policy (CSP)':    h['content-security-policy'],
      'X-Frame-Options':                  h['x-frame-options'],
      'X-Content-Type-Options':           h['x-content-type-options'],
      'Referrer-Policy':                  h['referrer-policy'],
      'Permissions-Policy':               h['permissions-policy'],
      'X-XSS-Protection':                 h['x-xss-protection'],
    };

    const present = Object.entries(checks).filter(([, v]) => v);
    const missing = Object.entries(checks).filter(([, v]) => !v);
    const score   = Math.round((present.length / Object.keys(checks).length) * 100);

    const bar = '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10));
    const rating = score >= 85 ? '💚 Excellent' : score >= 60 ? '🟡 Good' : score >= 40 ? '🟠 Fair' : '🔴 Poor';

    const presentLines = present.map(([k, v]) => `✅ *${k}*\n   \`${String(v).slice(0, 80)}\``).join('\n');
    const missingLines = missing.map(([k]) => `❌ ${k}`).join('\n');

    await send(sock, from, msg,
      `🛡️ *Security Headers: ${url}*\n\n` +
      `📊 Score: [${bar}] ${score}%\n` +
      `${rating}\n\n` +
      (presentLines ? `*Present Headers:*\n${presentLines}\n\n` : '') +
      (missingLines ? `*Missing Headers:*\n${missingLines}` : ''));
  } catch (err) {
    await send(sock, from, msg, `❌ Failed to scan headers: ${err.message}`);
  }
}

// ── SUBDOMAIN FINDER ──────────────────────────────────────────────────────────
async function subdomains(ctx) {
  const { sock, from, msg, args } = ctx;
  const domain = args[0]?.replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) return send(sock, from, msg, '🔍 *Usage:* .subdomains <domain>\nExample: .subdomains example.com');

  try {
    await sock.sendPresenceUpdate('composing', from).catch(() => {});
    const { data } = await axios.get(
      `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
      { timeout: 15000, headers: { 'Accept': 'application/json' } }
    );

    if (!Array.isArray(data) || !data.length) {
      return send(sock, from, msg, `🔍 No subdomains found for *${domain}* in certificate logs.`);
    }

    const unique = [...new Set(
      data.flatMap(e => (e.name_value || '').split('\n'))
          .map(s => s.trim().toLowerCase().replace(/^\*\./, ''))
          .filter(s => s.endsWith(domain) && s !== domain)
    )].sort().slice(0, 30);

    if (!unique.length) return send(sock, from, msg, `🔍 No unique subdomains found for *${domain}*.`);

    await send(sock, from, msg,
      `🔍 *Subdomains Found: ${domain}*\n` +
      `📊 Showing ${unique.length} unique subdomains from SSL certificate logs\n\n` +
      unique.map((s, i) => `${i + 1}. ${s}`).join('\n') +
      `\n\n_Source: crt.sh — certificate transparency logs_`);
  } catch (err) {
    await send(sock, from, msg, `❌ Subdomain lookup failed: ${err.message}`);
  }
}

// ── MAC ADDRESS VENDOR LOOKUP ─────────────────────────────────────────────────
async function macinfo(ctx) {
  const { sock, from, msg, args } = ctx;
  const mac = args[0];
  if (!mac) return send(sock, from, msg,
    '🖧 *Usage:* .macinfo <MAC address>\n\n' +
    '*Examples:*\n• .macinfo 00:1A:2B:3C:4D:5E\n• .macinfo 001A2B3C4D5E\n\n' +
    '_The first 6 hex digits (OUI) identify the manufacturer_');

  const cleaned = mac.replace(/[:\-\.]/g, '').toUpperCase();
  if (!/^[0-9A-F]{6,12}$/.test(cleaned)) return send(sock, from, msg, '❌ Invalid MAC address format.');

  try {
    const { data } = await axios.get(`https://api.macvendors.com/${encodeURIComponent(mac)}`, {
      timeout: 8000,
      validateStatus: s => s < 500
    });

    if (typeof data === 'string' && data.includes('errors')) {
      return send(sock, from, msg, `🖧 *MAC Lookup: ${mac}*\n\n❓ Vendor not found for OUI \`${cleaned.slice(0, 6)}\`\n\n_This may be a locally administered or randomized MAC address._`);
    }

    const oui = cleaned.slice(0, 6).match(/.{2}/g).join(':');
    await send(sock, from, msg,
      `🖧 *MAC Address Vendor Lookup*\n\n` +
      `📋 MAC: \`${mac}\`\n` +
      `🔑 OUI: \`${oui}\`\n` +
      `🏭 Vendor: *${data}*\n\n` +
      `_The OUI (first 3 octets) is assigned by IEEE to manufacturers._`);
  } catch (err) {
    await send(sock, from, msg, `❌ MAC lookup failed: ${err.message}`);
  }
}

// ── ROT47 CIPHER ──────────────────────────────────────────────────────────────
async function rot47(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg,
    '🔄 *ROT47 Cipher*\n\n' +
    '*Usage:* .rot47 <text>\n\n' +
    'ROT47 rotates all printable ASCII characters (33–126) by 47 positions.\n' +
    'Encoding and decoding use the same operation.\n\n' +
    '*Example:* .rot47 Hello World');

  const result = text.split('').map(c => {
    const code = c.charCodeAt(0);
    if (code >= 33 && code <= 126) {
      return String.fromCharCode(((code - 33 + 47) % 94) + 33);
    }
    return c;
  }).join('');

  await send(sock, from, msg,
    `🔄 *ROT47 Cipher*\n\n` +
    `📝 Input:  \`${text}\`\n\n` +
    `🔐 Output: \`${result}\`\n\n` +
    `_ROT47 is symmetric — apply it again to get back the original_`);
}

// ── URL EXPANDER / REPUTATION CHECK ───────────────────────────────────────────
async function urlinfo(ctx) {
  const { sock, from, msg, args } = ctx;
  let url = args[0];
  if (!url) return send(sock, from, msg,
    '🔗 *Usage:* .urlinfo <url>\nExample: .urlinfo bit.ly/abc123\n\n' +
    '_Expands short URLs and checks where they really lead_');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    await sock.sendPresenceUpdate('composing', from).catch(() => {});
    const history = [];
    let current = url;

    for (let i = 0; i < 10; i++) {
      try {
        const res = await axios.get(current, {
          maxRedirects: 0,
          validateStatus: s => true,
          timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0 (URLChecker)' }
        });
        history.push({ url: current, status: res.status });
        if (![301, 302, 303, 307, 308].includes(res.status)) break;
        const loc = res.headers['location'];
        if (!loc) break;
        current = loc.startsWith('http') ? loc : new URL(loc, current).href;
      } catch { break; }
    }

    const final = history[history.length - 1] || { url, status: '?' };
    const steps = history.length > 1
      ? `\n\n🔀 *Redirect Chain (${history.length - 1} hop${history.length > 2 ? 's' : ''}):*\n` +
        history.slice(0, -1).map((h, i) => `${i + 1}. \`${h.url.slice(0, 60)}\` → ${h.status}`).join('\n')
      : '';

    const suspicious = /bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|buff\.ly|rebrand\.ly/i.test(url);

    await send(sock, from, msg,
      `🔗 *URL Inspector*\n\n` +
      `📎 Original: \`${url}\`\n` +
      `🎯 Final URL: \`${final.url}\`\n` +
      `📊 Status: ${final.status}` +
      steps +
      `\n\n${suspicious ? '⚠️ _Short URL detected — always verify the destination before clicking!_' : '✅ _Direct URL — no redirection tricks detected_'}`);
  } catch (err) {
    await send(sock, from, msg, `❌ URL inspection failed: ${err.message}`);
  }
}

// ── FAKE CALL PRANK ───────────────────────────────────────────────────────────
async function fakecall(ctx) {
  const { sock, from, msg, text } = ctx;
  if (!text) return send(sock, from, msg,
    '📞 *Usage:* .fakecall <caller name>\n\n' +
    '*Examples:*\n' +
    '• .fakecall Mum\n' +
    '• .fakecall Boss Man\n' +
    '• .fakecall +254712345678\n\n' +
    '_Simulates a realistic incoming WhatsApp call notification_ 😈');

  const caller = text.trim();
  const delay = ms => new Promise(r => setTimeout(r, ms));

  // Ringing frames
  const ring1 = `📲 *Incoming WhatsApp call...*\n\n` +
    `┌─────────────────────┐\n` +
    `│  📞  *${caller}*\n` +
    `│  WhatsApp Voice Call\n` +
    `│\n` +
    `│  🔴 Decline   🟢 Accept\n` +
    `└─────────────────────┘`;

  const ring2 = `📲 *Incoming WhatsApp call...*\n\n` +
    `┌─────────────────────┐\n` +
    `│  📳  *${caller}*\n` +
    `│  WhatsApp Voice Call\n` +
    `│  🔔 Ringing...\n` +
    `│\n` +
    `│  🔴 Decline   🟢 Accept\n` +
    `└─────────────────────┘`;

  const ring3 = `📲 *Incoming WhatsApp call...*\n\n` +
    `┌─────────────────────┐\n` +
    `│  📞  *${caller}*\n` +
    `│  WhatsApp Voice Call\n` +
    `│  🔔 Ringing...\n` +
    `│  🔔 Ringing...\n` +
    `│\n` +
    `│  🔴 Decline   🟢 Accept\n` +
    `└─────────────────────┘`;

  const missed = `📵 *Missed WhatsApp call*\n\n` +
    `┌─────────────────────┐\n` +
    `│  📵  *${caller}*\n` +
    `│  WhatsApp Voice Call\n` +
    `│  ❌ Missed call\n` +
    `│  🕐 Just now\n` +
    `└─────────────────────┘\n\n` +
    `_Tap to call back_`;

  try {
    await sock.sendMessage(from, { text: ring1 }, { quoted: msg });
    await delay(2500);
    await sock.sendMessage(from, { text: ring2 });
    await delay(2500);
    await sock.sendMessage(from, { text: ring3 });
    await delay(3000);
    await sock.sendMessage(from, { text: missed });
    console.log(`[FAKECALL] Done — caller="${caller}" in ${from}`);
  } catch (err) {
    await send(sock, from, msg, `❌ Fake call failed: ${err.message}`);
  }
}

// ── FAKE HACK ANIMATION ───────────────────────────────────────────────────────
function randHex(len) {
  return [...Array(len)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randIP() {
  return `${randInt(1,254)}.${randInt(0,255)}.${randInt(0,255)}.${randInt(1,254)}`;
}
function randMAC() {
  return [...Array(6)].map(() => randHex(2).toUpperCase()).join(':');
}
function randCoords() {
  const lat = (Math.random() * 180 - 90).toFixed(6);
  const lon = (Math.random() * 360 - 180).toFixed(6);
  return `${lat}, ${lon}`;
}

const FAKE_CARRIERS  = ['Safaricom','Airtel','Telkom','MTN','Vodafone','T-Mobile','AT&T','Orange'];
const FAKE_DEVICES   = ['Samsung Galaxy S24','iPhone 15 Pro','Tecno Camon 20','Infinix Hot 40','Xiaomi Redmi Note 13','OnePlus 12'];
const FAKE_OS        = ['Android 14','Android 13','iOS 17.4','iOS 16.7','MIUI 15','One UI 6.1'];
const FAKE_BROWSERS  = ['Chrome/124','Safari/17','Firefox/125','Edge/123'];
const FAKE_NAMES     = ['James Mwangi','Amina Hassan','Brian Ochieng','Grace Njeri','Kevin Waweru','Fatuma Ali','David Kamau'];
const FAKE_EMAILS    = ['***@gmail.com','***@yahoo.com','***@outlook.com','***@hotmail.com'];
const FAKE_BANKS     = ['KCB Bank','Equity Bank','Cooperative Bank','ABSA Bank','Standard Chartered'];

async function hack(ctx) {
  const { sock, from, msg, text, isGroup } = ctx;
  if (!text) return send(sock, from, msg,
    '💀 *Usage:* .hack <phone number>\n\n*Example:* .hack +254712345678\n\n_⚠️ For entertainment purposes only_');

  const number = text.trim().replace(/\s+/g, '');
  const displayNum = number.startsWith('+') ? number : `+${number}`;

  const delay = ms => new Promise(r => setTimeout(r, ms));

  const steps = [
    `\`\`\`\n[ FIREBOX HACKER v3.7 ]\n> Initializing target: ${displayNum}\n> Loading exploit modules...\n████░░░░░░ 40%\`\`\``,
    `\`\`\`\n> Bypassing firewall...\n> Spoofing source IP: ${randIP()}\n> Establishing encrypted tunnel...\n████████░░ 80%\`\`\``,
    `\`\`\`\n> Injecting payload...\n> Cracking signal encryption...\n> Access granted ✓\n██████████ 100%\`\`\``,
    `\`\`\`\n[ NETWORK SCAN COMPLETE ]\n> Device IP   : ${randIP()}\n> MAC Address : ${randMAC()}\n> GPS Coords  : ${randCoords()}\n> Signal      : ${randInt(60,99)}% (4G LTE)\`\`\``,
    `\`\`\`\n[ DEVICE INFO ]\n> Model  : ${FAKE_DEVICES[randInt(0,FAKE_DEVICES.length-1)]}\n> OS     : ${FAKE_OS[randInt(0,FAKE_OS.length-1)]}\n> Browser: ${FAKE_BROWSERS[randInt(0,FAKE_BROWSERS.length-1)]}\n> IMEI   : ${randInt(100000,999999)}${randInt(100000,999999)}${randInt(100,999)}\`\`\``,
    `\`\`\`\n[ CARRIER INFO ]\n> Network  : ${FAKE_CARRIERS[randInt(0,FAKE_CARRIERS.length-1)]}\n> SIM ICCID: ${randHex(10).toUpperCase()}\n> Roaming  : ${Math.random()>0.7?'Yes':'No'}\n> 2FA SMS  : Intercepted ✓\`\`\``,
    `\`\`\`\n[ PERSONAL DATA EXTRACTED ]\n> Name    : ${FAKE_NAMES[randInt(0,FAKE_NAMES.length-1)]}\n> Email   : ${FAKE_EMAILS[randInt(0,FAKE_EMAILS.length-1)]}\n> Bank    : ${FAKE_BANKS[randInt(0,FAKE_BANKS.length-1)]}\n> Balance : KES ${randInt(1,99)},${randInt(100,999)}.${randInt(10,99)}\`\`\``,
    `\`\`\`\n[ SESSION TOKENS ]\n> Auth Token  : ${randHex(32)}\n> Cookie Hash : ${randHex(16)}\n> Session ID  : ${randHex(8)}-${randHex(4)}-${randHex(4)}\n> Expires     : NEVER (stolen ✓)\`\`\``,
  ];

  try {
    await sock.sendMessage(from, { text: steps[0] }, { quoted: msg });

    for (let i = 1; i < steps.length; i++) {
      await delay(1500);
      await sock.sendMessage(from, { text: steps[i] });
    }

    await delay(1500);
    await sock.sendMessage(from, {
      text:
        `💀 *HACK COMPLETE*\n\n` +
        `📱 Target: *${displayNum}*\n` +
        `✅ Device compromised\n` +
        `✅ Location tracked\n` +
        `✅ Messages intercepted\n` +
        `✅ Credentials stolen\n\n` +
        `_⚠️ This is 100% fake entertainment — no real hacking occurred. Actual hacking is illegal._\n\n` +
        `_Powered by 🔥 Firebox_`
    });
    console.log(`[HACK] Done — ${isGroup ? 'GROUP' : 'DM'} ${from}`);
  } catch (err) {
    console.error(`[HACK] Error in ${isGroup ? 'GROUP' : 'DM'} ${from}:`, err.message);
    await send(sock, from, msg, `❌ Hack failed: ${err.message}`);
  }
}

module.exports = { checkpass, hash, b64encode, b64decode, hexencode, hexdecode, iplookup, dnslookup, whois, portinfo, cipher, scamalyze, numlookup, sslcheck, headers, subdomains, macinfo, rot47, urlinfo, hack, fakecall };
