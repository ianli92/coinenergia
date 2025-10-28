import axios from "axios";
import * as cheerio from "cheerio";
import dayjs from "dayjs";
import { google } from "googleapis";

// Variáveis de ambiente (inseridas via GitHub Secrets)
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const spreadsheetId = process.env.SHEET_ID;

const SHEET_NAME = "links";
const SOURCE_URL = "https://coinmaster-daily.com/pt";

// --- Cria o cliente do Google Sheets ---
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

// --- Lê URLs já existentes na planilha ---
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
    if (e.response?.status === 400) {
      // cria cabeçalhos se planilha estiver vazia
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A1:D1`,
        valueInputOption: "RAW",
        requestBody: { values: [["data", "titulo", "url", "fonte"]] }
      });
      console.log("✅ Planilha criada com cabeçalhos.");
      return new Set();
    }
    throw e;
  }
}

// --- Web Scraper ---
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
    // Pega todos os <a> dentro de cada bloco
    $(block)
      .find("a")
      .each((_, linkElement) => {
        let url =
          $(linkElement).attr("href") ||
          $(linkElement).attr("data-href") ||
          $(linkElement).attr("data-url") ||
          "";
        url = url.trim();

        let titulo = ($(linkElement).text() || "").trim() || "Recompensa";

        if (!url || !/^https?:\/\//i.test(url)) return;
        links.push({ url, titulo });
      });
  });

  // Remove duplicados dentro da mesma coleta
  const seen = new Set();
  const unique = links.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });

  console.log(`📋 Coletados ${unique.length} links únicos de ${blocks.length} blocos.`);
  return unique;
}

// --- Insere linhas novas na planilha ---
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

// --- Execução principal ---
(async () => {
  try {
    const sheets = await getSheetsClient();
    const existing = await readExistingUrls(sheets);
    const scraped = await scrapeLinks();

    const today = dayjs().format("YYYY-MM-DD");

    // Filtra apenas os novos links
    const novos = scraped.filter(x => !existing.has(x.url));

    const toInsert = novos.map(x => ({
      data: today,
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
