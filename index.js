import axios from "axios";
import * as cheerio from "cheerio";
import dayjs from "dayjs";
import { google } from "googleapis";

// 🔐 Credenciais e ID da planilha (via GitHub Secrets)
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const spreadsheetId = process.env.SHEET_ID;

// ⚙️ Configurações
const SHEET_NAME = "links";
const SOURCE_URL = "https://coinmaster-daily.com/pt";

// ==========================================================
// 🔧 1. Conecta no Google Sheets
// ==========================================================
async function getSheetsClient() {
  const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    scopes
  );
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

// ==========================================================
// 📖 2. Lê URLs existentes na planilha (para não repetir)
// ==========================================================
async function readExistingUrls(sheets) {
  const range = `${SHEET_NAME}!C2:C`; // coluna C = url
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = res.data.values || [];
    const set = new Set(rows.map(r => (r[0] || "").trim()).filter(Boolean));
    console.log(`🔍 ${set.size} URLs já existentes na planilha.`);
    return set;
  } catch (e) {
    // Se a aba não existir ainda, cria automaticamente
    if (e.response?.status === 400 || e.message.includes("Unable to parse range")) {
      console.log("⚙️ Criando aba 'links'...");
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: SHEET_NAME }
              }
            }
          ]
        }
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A1:D1`,
        valueInputOption: "RAW",
        requestBody: { values: [["data", "titulo", "url", "fonte"]] }
      });
      console.log("✅ Aba 'links' criada com cabeçalhos.");
      return new Set();
    }
    throw e;
  }
}

// ==========================================================
// 🕷️ 3. Faz o scraping do site CoinMaster Daily
// ==========================================================
async function scrapeLinks() {
  console.log("🌐 Buscando links em:", SOURCE_URL);

  const res = await axios.get(SOURCE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    },
    timeout: 20000
  });

  const $ = cheerio.load(res.data);
  const links = [];

  const blocks = $(".fs-collect");
  console.log(`🔎 Encontrados ${blocks.length} blocos .fs-collect`);

  blocks.each((i, block) => {
    const linkElement = $(block).find("a").first();
    let url = (linkElement.attr("href") || "").trim();
    let titulo = (linkElement.text() || "").trim() || "Recompensa";

    if (!url) return;

    // Adiciona domínio se o link for relativo (ex: "/?gift=970473")
    if (url.startsWith("/")) {
      url = `https://coinmaster-daily.com${url}`;
    }

    // Pega a data real no bloco .fs-meta logo após o .fs-collect
    const metaBlock = $(block).next(".fs-meta");
    let dataTexto = metaBlock.find(".fs-clicks").first().text().trim();

    // Normaliza a data (YYYY-MM-DD)
    let dataFormatada = "";
    if (dataTexto && /\d{4}-\d{2}-\d{2}/.test(dataTexto)) {
      dataFormatada = dataTexto.match(/\d{4}-\d{2}-\d{2}/)[0];
    } else {
      dataFormatada = dayjs().format("YYYY-MM-DD");
    }

    // Só aceita links válidos
    if (!/^https?:\/\//i.test(url)) return;

    links.push({ url, titulo, data: dataFormatada });
  });

  // Remove duplicados
  const seen = new Set();
  const unique = links.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });

  console.log(`📋 Coletados ${unique.length} links únicos de ${blocks.length} blocos.`);
  return unique;
}

// ==========================================================
// 🧾 4. Escreve novos dados na planilha
// ==========================================================
async function appendRows(sheets, rows) {
  if (!rows.length) {
    console.log("🟡 Nenhum link novo para inserir.");
    return 0;
  }

  const range = `${SHEET_NAME}!A:D`;
  const body = {
    values: rows.map(r => [r.data, r.titulo, r.url, r.fonte])
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: body
  });

  console.log(`✅ Inseridos ${rows.length} novos links.`);
  return rows.length;
}

// ==========================================================
// 🚀 5. Execução principal
// ==========================================================
(async () => {
  try {
    const sheets = await getSheetsClient();
    const existing = await readExistingUrls(sheets);
    const scraped = await scrapeLinks();

    // Filtra só os que ainda não existem
    const novos = scraped.filter(x => !existing.has(x.url));

    const toInsert = novos.map(x => ({
      data: x.data || dayjs().format("YYYY-MM-DD"),
      titulo: x.titulo,
      url: x.url,
      fonte: SOURCE_URL
    }));

    await appendRows(sheets, toInsert);
  } catch (err) {
    console.error("❌ ERRO:", err?.message);
    console.error(err?.response?.data || "");
    process.exit(1);
  }
})();
