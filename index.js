const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');
const cheerio = require('cheerio');

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const spreadsheetId = process.env.SHEET_ID;

async function main() {
  const doc = new GoogleSpreadsheet(spreadsheetId);
  await doc.useServiceAccountAuth(credentials);
  await doc.loadInfo();
  
  const sheet = doc.sheetsByIndex[0]; // primeira aba da planilha
  await sheet.loadCells();

  // Ler links existentes
  const rows = await sheet.getRows();
  const existingLinks = rows.map(row => row.Link); // coluna Link

  // Buscar página
  const { data } = await axios.get('https://coinmaster-daily.com/pt');
  const $ = cheerio.load(data);

  // Extrair todos os links das classes .fs-collect
  const linksOnPage = [];
  $('.fs-collect').each((i, el) => {
    const link = $(el).attr('href');
    if (link && !existingLinks.includes(link) && !linksOnPage.includes(link)) {
      // Evita links duplicados na página e na planilha
      linksOnPage.push(link);
    }
  });

  // Adicionar novos links na planilha
  for (const link of linksOnPage) {
    await sheet.addRow({ Link: link });
    console.log('Adicionado:', link);
  }

  console.log('Todos os links novos foram adicionados!');
}

main().catch(console.error);
