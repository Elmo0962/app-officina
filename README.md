# App Procedure Officina — Prototipo v1.0

Applicazione web per la digitalizzazione delle procedure operative nelle officine meccaniche italiane.
Gli operai seguono le guide operative su tablet montati a parete. I supervisori approvano le guide e gestiscono i problemi. I titolari vedono le statistiche. L'admin gestisce le aziende.

---

## Struttura del progetto

```
app-officina/
├── index.html        — struttura HTML: schermate, modali, login
├── style.css         — stili: layout, componenti, animazioni
├── app.js            — logica JavaScript: Supabase, navigazione, funzionalità
├── supabase.min.js   — libreria Supabase (locale, non CDN)
└── README.md         — questo file
```

---

## Database Supabase

Progetto: `ggnjiemcqcwlzgtojnyy` (app-officina-dev)

### Tabelle

| Tabella | Descrizione |
|---|---|
| `companies` | Aziende clienti |
| `operai` | Utenti con ruolo e PIN |
| `guide` | Procedure operative (approvata=true per essere visibili) |
| `steps` | Passi singoli di una guida |
| `executions` | Sessioni di esecuzione (apertura guida → chiusura) |
| `executions_checklist` | Step completati in una sessione |
| `error_log` | Errori segnalati dagli operai |
| `suggerimenti` | Proposte di modifica agli step |
| `sessioni_tablet` | Predisposta per il tracking multi-tablet (non ancora usata) |

### Schema essenziale

```sql
-- Aziende
companies: id, name, created_at

-- Utenti
operai: id, company_id→companies, nome, email, ruolo, pin, created_at

-- Guide e step
guide: id, company_id→companies, titolo, descrizione, categoria,
       created_by, approvata(bool), created_at
steps: id, guide_id→guide, ordine, testo, note, criticità, immagine_rif_url

-- Esecuzioni
executions: id, guide_id→guide, user_id→operai, stato, data_inizio, data_fine
executions_checklist: id, execution_id→executions, step_id→steps,
                      completato, foto_url, nota_operaio, timestamp

-- Segnalazioni e suggerimenti
error_log: id, user_id, guide_id, step_id, tipo_errore, descrizione,
           stato, note_chiusura, chiuso_da, data_chiusura
suggerimenti: id, operaio_id→operai, guide_id→guide, step_id→steps,
              tipo, descrizione, urgenza, stato
```

### Storage

Bucket: `guide-photos` (pubblico)
Le immagini degli step vengono caricate con nome: `{guide_id}-step{n}-{timestamp}.{ext}`
Il campo `immagine_rif_url` in `steps` contiene solo il nome del file, non l'URL completo.
L'URL completo viene costruito in app.js: `https://ggnjiemcqcwlzgtojnyy.supabase.co/storage/v1/object/public/guide-photos/{nome_file}`

---

## Ruoli utente

| Ruolo | Schermata | Permessi |
|---|---|---|
| `operaio` | Home con guide | Segue guide, completa step, segnala errori, propone modifiche |
| `supervisore` | Vista supervisore | Approva/elimina bozze, chiude errori, vede attività, archivia suggerimenti |
| `titolare` | Dashboard | Solo lettura: statistiche, grafico, operai attivi, errori aperti |
| `admin` | Pannello admin | Gestisce tutte le aziende, crea/modifica/elimina operai |

---

## Funzionamento del login

1. Il tablet ha un'azienda memorizzata in `localStorage` (scelta alla prima accensione)
2. L'operaio seleziona il proprio nome dalla lista e inserisce il PIN a 4 cifre
3. Il sistema verifica il PIN confrontandolo con il valore in Supabase (tabella `operai`)
4. Dopo verifica: l'utente viene assegnato allo slot 1 o 2 del tablet
5. Supervisore e titolare vedono i dati della **propria** azienda, non quella del tablet

### Sistema multi-slot (due utenti per tablet)
- Ogni tablet supporta 2 utenti in sessione contemporanea
- La barra in basso mostra i due slot con le iniziali degli utenti
- Al cambio slot: lo stato della guida in corso viene salvato in `statoSlot`
- Al ritorno: `riprendiGuida()` rilegge da Supabase gli step già completati

---

## Variabili globali principali (app.js)

```javascript
aziendaSelezionata   // {id, name} — azienda attiva
operaioCorrente      // {id, nome, ruolo} — utente attivo
slot1, slot2         // utenti nei due slot del tablet
slotAttivo           // 1 o 2
esecuzioneId         // UUID dell'esecuzione corrente in tabella executions
guidaCorrente        // oggetto guida aperta (serve per guide_id in error_log)
statoSlot            // { 1: {guida, esecuzioneId}, 2: {guida, esecuzioneId} }
tutteLeGuide         // array guide caricate (per filtro categoria e ricerca)
```

---

## Categorie guide

Le 5 categorie sono definite nell'HTML (non su database):
- Carpenteria
- Serbatoi
- Piping
- Collaudi
- Attrezzatura

Per aggiungere categorie: modificare le card in `index.html` e le option nel form proposta guida.

---

## Flusso operaio — esecuzione guida

```
Home → seleziona categoria → lista guide → apre guida
  → avviaSessione() crea riga in executions (stato: in corso)
  → per ogni step: completaStep() crea riga in executions_checklist
  → chiudiSessione() aggiorna executions (stato: completata, data_fine)
  → torna alla Home
```

---

## Flusso supervisore — gestione errori

```
Operaio preme "Segnala problema" durante l'esecuzione
  → inviaErrore() salva in error_log (stato: aperto, guide_id obbligatorio)
  → Supervisore vede l'errore nella vista supervisore
  → chiudiErrore() aggiorna error_log (stato: risolto, nota_chiusura)
```

**IMPORTANTE**: `guide_id` in `error_log` è obbligatorio per il filtraggio per azienda.
Senza di esso gli errori non appaiono nella vista supervisore.

---

## Flusso proposta guida

```
Operaio clicca "Proponi guida" → compila form (titolo, categoria, step, foto)
  → salvaGuida() inserisce in guide (approvata=false) + steps
  → Supervisore vede la bozza in "Guide in bozza"
  → approvaGuida() imposta approvata=true → guida visibile agli operai
```

---

## Filtro dati per azienda

Tutte le query filtrano per `company_id` dell'azienda selezionata.
Per le tabelle senza `company_id` diretto (executions, error_log, suggerimenti)
il filtro avviene tramite gli ID delle guide dell'azienda:

```javascript
const { data: guideIds } = await db.from('guide').select('id').eq('company_id', aziendaSelezionata.id)
const ids = guideIds.map(g => g.id)
// poi: .in('guide_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
```

L'UUID fittizio `00000000-0000-0000-0000-000000000000` è usato come fallback
per evitare errori Supabase quando l'array è vuoto.

---

## Sicurezza — stato attuale (prototipo)

⚠️ Questo è un prototipo. Prima del deploy in produzione:

- [ ] Abilitare Row Level Security (RLS) su tutte le tabelle Supabase
- [ ] Sostituire il PIN client-side con Supabase Auth o una RPC sicura
- [ ] Implementare l'autenticazione server-side
- [ ] Ruotare la `SUPABASE_KEY` (la chiave pubblica attuale è visibile nel codice)
- [ ] Aggiungere validazione input server-side
- [ ] Implementare il constraint `executions_user_id_fkey` (rimosso durante sviluppo)

---

## Funzionalità implementate

- [x] Login multi-azienda con PIN a 4 cifre
- [x] Sistema multi-slot (2 utenti per tablet) con ripresa sessione
- [x] 4 ruoli: operaio, supervisore, titolare, admin
- [x] Guide operative con step, criticità, note, foto
- [x] Esecuzione guidata con completamento step in tempo reale
- [x] Segnalazione errori con filtro per azienda
- [x] Proposta nuova guida con step e foto
- [x] Vista supervisore: errori, bozze, attività, suggerimenti
- [x] Dashboard titolare: statistiche, grafico 7 giorni, top operai
- [x] Pannello admin: gestione aziende e operai
- [x] Filtro per categoria e ricerca in tempo reale
- [x] Guide recenti in home
- [x] Pubblicato su GitHub Pages

## Funzionalità da implementare (versione definitiva)

- [ ] Autenticazione sicura con Supabase Auth
- [ ] Notifiche email/WhatsApp al supervisore
- [ ] Cache offline (Service Worker)
- [ ] Gamification con punteggio operai
- [ ] Modifica diretta degli step dal supervisore
- [ ] Logout esplicito
- [ ] Storico suggerimenti archiviati
- [ ] Ruolo admin separato da aziende (non visibile nella lista operai)
- [ ] Possibilità di riordinare gli step
- [ ] Supporto tablet dedicato per operaio (attualmente 2 per tablet)

---

## Deploy

L'app è pubblicata su GitHub Pages:
`https://[username].github.io/app-officina`

Per aggiornare: modifica i file localmente → carica su GitHub → Pages si aggiorna automaticamente in 1-2 minuti.

---

## Credenziali di test

| Nome | Ruolo | PIN | Azienda |
|---|---|---|---|
| Davide Boni | supervisore | 1234 | Officina Meccanica Ferretti Srl |
| Marco Rossi | operaio | 5678 | Officina Meccanica Ferretti Srl |
| Marco Ferretti | titolare | 9999 | Officina Meccanica Ferretti Srl |
| Admin | admin | 0000 | (qualsiasi) |
