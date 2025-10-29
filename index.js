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
// 🔧 1. Conecta ao Google Sheets
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
// 📖 2. Lê URLs existentes (para evitar duplicados)
// ==========================================================
async function readExistingUrls(sheets) {
  const range = `${SHEET_NAME}!C2:C`; // Coluna C = url
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

    // Adiciona domínio se o link for relativo
    if (url.startsWith("/")) {
      url = `https://coinmaster-daily.com${url}`;
    }

    // Pega a data real no bloco .fs-meta logo após o .fs-collect
    const metaBlock = $(block).next(".fs-meta");
    let dataTexto = metaBlock.find(".fs-clicks").first().text().trim();

    let dataFormatada = "";
    if (dataTexto && /\d{4}-\d{2}-\d{2}/.test(dataTexto)) {
      dataFormatada = dataTexto.match(/\d{4}-\d{2}-\d{2}/)[0];
    } else {
      dataFormatada = dayjs().format("YYYY-MM-DD");
    }

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
// 🧾 4. Insere novos links no topo da planilha
// ==========================================================
// Insere novos links no topo e remove os mais antigos se necessário
async function insertNewLinksAtTop(sheets, scraped, existing) {
  const today = dayjs().format("YYYY-MM-DD");

  const novos = scraped.filter(x => !existing.has(x.url));

  if (novos.length === 0) {
    console.log("🟡 Nenhum link novo para inserir.");
    return;
  }

  console.log(`🆕 Inserindo ${novos.length} novos links no topo...`);

  const newValues = novos.map(x => [
    x.data || today,
    x.titulo,
    x.url,
    SOURCE_URL
  ]);

  // Pega o conteúdo atual da planilha
  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:D`
  });

  const oldValues = current.data.values || [];

  // Junta novos links (em cima) + antigos (embaixo)
  const allValues = [...newValues, ...oldValues];

  // Limita a 30 links: mantém os mais recentes e remove os mais antigos
  const limitedValues = allValues.slice(0, 30);

  // Atualiza a planilha com os novos valores
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:D`,
    valueInputOption: "RAW",
    requestBody: { values: limitedValues }
  });

  console.log(`✅ Inseridos ${novos.length} novos links no topo.`);
}


// ==========================================================
// 🚀 5. Execução principal
// ==========================================================
(async () => {
  try {
    const sheets = await getSheetsClient();
    const existing = await readExistingUrls(sheets);
    const scraped = await scrapeLinks();

    await insertNewLinksAtTop(sheets, scraped, existing);
  } catch (err) {
    console.error("❌ ERRO:", err?.message);
    console.error(err?.response?.data || "");
    process.exit(1);
  }
})();

