import axios from "axios";
import * as cheerio from "cheerio";
import { google } from "googleapis";
import { readFile } from "fs/promises";


const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const spreadsheetId = process.env.SHEET_ID;

async function run() {
  try {
    const url = "https://coinmaster-daily.com/pt";
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // pega todos os links de recompensa
    const links = [];
    $("a.btn.btn-primary").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.startsWith("http")) links.push(href);
    });

    if (links.length === 0) {
      console.log("Nenhum link encontrado.");
      return;
    }

    // autenticação com Google Sheets
    const credentials = JSON.parse(await readFile("./credenciais.json", "utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheetId = "1RBtgXmVYzILGsF5i8qumo7AVUKKLVAhfvKhnXXQ4hy8";
    const dataHoje = new Date().toISOString().split("T")[0];

    // adiciona linhas na planilha
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "A:B",
      valueInputOption: "RAW",
      requestBody: {
        values: links.map((l) => [dataHoje, l]),
      },
    });

    console.log(`${links.length} links adicionados em ${dataHoje}`);
  } catch (err) {
    console.error("Erro ao executar:", err.message);
  }
}

run();

