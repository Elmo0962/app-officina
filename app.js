// ============================================================
// APP PROCEDURE OFFICINA — app.js
// ============================================================
// Prototipo HTML/JS su Supabase — versione con login multi-utente
//
// STRUTTURA GENERALE:
// 1. Configurazione Supabase e variabili globali
// 2. Inizializzazione login al caricamento della pagina
// 3. Funzioni di login: selezione azienda, PIN, routing per ruolo
// 4. Tastiera PIN e gestione sessione tablet
// 5. Home operaio: guide, categorie, ricerca, recenti
// 6. Esecuzione guida: step, completamento, sessione su Supabase
// 7. Ripresa guida (multi-slot): stato persistente da Supabase
// 8. Vista supervisore: errori, bozze, attività, suggerimenti
// 9. Dashboard titolare: statistiche e grafico
// 10. Pannello admin: gestione aziende e operai
// 11. Modali: errore, suggerimento modifica
// 12. Notifiche inline
//
// DATABASE SUPABASE (progetto: ggnjiemcqcwlzgtojnyy):
// - companies: aziende clienti
// - operai: utenti con ruolo (operaio/supervisore/titolare/admin) e PIN
// - guide: procedure operative (approvata=true per essere visibili)
// - steps: passi singoli di una guida (con criticità, note, foto)
// - executions: sessioni di esecuzione di una guida da parte di un operaio
// - executions_checklist: singoli step completati in una sessione
// - error_log: errori segnalati dagli operai durante l'esecuzione
// - suggerimenti: proposte di modifica agli step da parte degli operai
//
// RUOLI UTENTE:
// - operaio: vede le guide della sua azienda, esegue step, segnala errori
// - supervisore: gestisce errori, approva/elimina bozze, vede attività
// - titolare: dashboard read-only con statistiche (solo lettura)
// - admin: gestione multi-azienda, crea/modifica/elimina aziende e operai
//
// FUNZIONALITÀ MANCANTI (da implementare nella versione definitiva):
// - Autenticazione sicura (attualmente PIN in chiaro, RLS disabilitato)
// - Notifiche email/WhatsApp al supervisore
// - Cache offline per uso senza connessione
// - Gamification con punteggio operai
// - Modifica diretta degli step dal supervisore
// - Logout esplicito con bottone dedicato
// ============================================================

// ── CONNESSIONE SUPABASE ──────────────────────────────────────────────
// URL e chiave pubblica del progetto Supabase.
// ATTENZIONE: in produzione queste credenziali devono essere protette
// con Row Level Security (RLS) abilitata su tutte le tabelle.
const SUPABASE_URL = 'https://ggnjiemcqcwlzgtojnyy.supabase.co'
const SUPABASE_KEY = 'sb_publishable_P_UsmvxgGRUxck_iCjEqiA_uloi5PY1'

const { createClient } = supabase
const db = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── CONFIGURAZIONE TABLET ──────────────────────────────────────────────
// Ogni tablet riceve un ID univoco generato casualmente e salvato in
// localStorage. Serve per identificare il dispositivo fisico nel sistema
// multi-slot (due operai per tablet). Non ancora usato attivamente nelle
// query, predisposto per funzionalità future.
const TABLET_ID = 'tablet-' + (localStorage.getItem('tablet_id') || (() => {
  const id = Math.random().toString(36).substr(2, 9)
  localStorage.setItem('tablet_id', id)
  return id
})())

// ── VARIABILI GLOBALI DI STATO ────────────────────────────────────────
// Queste variabili tracciano lo stato corrente dell'intera applicazione.
// Non usare localStorage per lo stato di sessione — si perde al ricaricamento.

let aziendaSelezionata = null    // Oggetto {id, name} dell'azienda attiva sul tablet
let operaioCorrente = null       // Oggetto {id, nome, ruolo} dell'utente attivo
let slot1 = null                 // Operaio nel primo slot del tablet
let slot2 = null                 // Operaio nel secondo slot del tablet
let slotAttivo = 1               // Quale slot è attualmente in uso (1 o 2)
let pinBuffer = ''               // Cifre PIN inserite finora (stringa, max 4 caratteri)
let operaioInLogin = null        // Operaio selezionato nella schermata di login

// Stato persistente per ogni slot: guida aperta e ID esecuzione attiva.
// Quando si cambia slot, lo stato viene salvato qui e ripristinato al ritorno.
let statoSlot = {
  1: { guida: null, esecuzioneId: null },
  2: { guida: null, esecuzioneId: null }
}

let guidaCorrente = null         // Guida attualmente aperta (oggetto completo)
let adminAziendaSelezionata = null  // Azienda selezionata nel pannello admin
let operaioInModifica = null     // Operaio in modifica nel pannello admin

// ── AVVIO APPLICAZIONE ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

  // Array delle guide caricate per l'azienda corrente.
  // Usato per il filtro per categoria e la ricerca in tempo reale.
  let tutteLeGuide = []

  // ── INIZIALIZZAZIONE LOGIN ─────────────────────────────────────────
  // Al caricamento, l'app (#app) viene nascosta e viene mostrato il login.
  // Se l'azienda è già memorizzata in localStorage (scelta in precedenza),
  // si salta la selezione azienda e si va direttamente al PIN.
  document.getElementById('app').style.display = 'none'
  const aziendaSalvata = localStorage.getItem('azienda_id')
  const aziendaNomeSalvato = localStorage.getItem('azienda_nome')

  if (aziendaSalvata) {
    // Azienda già scelta: vai direttamente alla tastiera PIN
    aziendaSelezionata = { id: aziendaSalvata, name: aziendaNomeSalvato }
    document.getElementById('login-azienda-nome').textContent = aziendaNomeSalvato
    mostraSchermataLogin('login-pin')
    caricaOperaiAzienda(aziendaSalvata)
  } else {
    // Prima volta o dopo cambio azienda: mostra la selezione azienda
    mostraSchermataLogin('login-azienda')
    caricaAziende()
  }

  // ── GUIDE ─────────────────────────────────────────────────────────

  // Carica le guide approvate dell'azienda corrente da Supabase.
  // Filtra per company_id per garantire isolamento tra aziende diverse.
  async function caricaGuide() {
    if (!aziendaSelezionata) return

    const { data, error } = await db
      .from('guide')
      .select('id, titolo, categoria, company_id')
      .eq('approvata', true)
      .eq('company_id', aziendaSelezionata.id)

    if (error) {
      console.error('Errore caricamento guide:', error.message)
      return
    }

    tutteLeGuide = data
    mostraGuide(data)
  }

  // Renderizza la lista delle guide come card cliccabili.
  // Ogni card mostra categoria e titolo. Al click apre la pagina degli step.
  function mostraGuide(guide) {
    const lista = document.getElementById('lista-guide')
    lista.innerHTML = ''

    guide.forEach(function(guida) {
      const card = document.createElement('div')
      card.className = 'card-guida'
      card.addEventListener('click', function() {
        apriGuida(guida)
      })
      card.innerHTML =
        '<span class="categoria">' + (guida.categoria || 'Generale') + '</span>' +
        '<h2>' + guida.titolo + '</h2>'
      lista.appendChild(card)
    })
  }

  // Categoria attiva nel filtro. 'tutte' mostra tutte le guide.
  let categoriaAttiva = 'tutte'

  // Ultimi 3 accessi alle guide per la sezione "Hai usato di recente" in home.
  // Non persiste al ricaricamento — solo per la sessione corrente.
  let guidheRecenti = []

  // ── UTILITÀ UI ────────────────────────────────────────────────────

  // Scrive la data corrente in italiano nella home (es. "Lunedì 13 aprile 2026")
  function impostaData() {
    const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
    const mesi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
    const ora = new Date()
    const testo = giorni[ora.getDay()] + ' ' + ora.getDate() + ' ' + mesi[ora.getMonth()] + ' ' + ora.getFullYear()
    document.getElementById('home-data').textContent = testo
  }

  // ── NAVIGAZIONE LOGIN ──────────────────────────────────────────────

  // Mostra la schermata di login (sfondo scuro fisso) e il pannello corretto
  // al suo interno ('login-azienda' o 'login-pin'). Nasconde tutte le schermate app.
  function mostraSchermataLogin(quale) {
    document.getElementById('schermata-home').style.display = 'none'
    document.getElementById('schermata-lista').style.display = 'none'
    document.getElementById('schermata-step').style.display = 'none'
    document.getElementById('schermata-supervisore').style.display = 'none'
    document.getElementById('schermata-proponi').style.display = 'none'
    document.getElementById('schermata-login').style.display = 'flex'
    document.getElementById('login-azienda').style.display = 'none'
    document.getElementById('login-pin').style.display = 'none'
    document.getElementById('schermata-titolare').style.display = 'none'
    document.getElementById('schermata-admin').style.display = 'none'

    const target = document.getElementById(quale)
    target.style.display = 'flex'
    target.style.flexDirection = 'column'
    target.style.alignItems = 'center'
    target.style.width = '100%'
  }

  // Nasconde il login e mostra l'app dopo autenticazione riuscita.
  function nascondiLogin() {
    document.getElementById('schermata-login').style.display = 'none'
    document.getElementById('app').style.display = 'block'
  }

  // ── SELEZIONE AZIENDA ──────────────────────────────────────────────

  // Carica tutte le aziende da Supabase e le mostra come card cliccabili.
  // Al click: salva l'azienda in localStorage e passa alla schermata PIN.
  // L'azienda viene memorizzata così al prossimo ricaricamento si salta questo step.
  async function caricaAziende() {
    const { data, error } = await db.from('companies').select('id, name')
    if (error || !data) return
    const lista = document.getElementById('lista-aziende')
    lista.innerHTML = ''
    data.forEach(function(az) {
      const card = document.createElement('div')
      card.className = 'card-azienda'
      card.textContent = az.name
      card.addEventListener('click', function() {
        localStorage.setItem('azienda_id', az.id)
        localStorage.setItem('azienda_nome', az.name)
        aziendaSelezionata = az
        document.getElementById('login-azienda-nome').textContent = az.name
        mostraSchermataLogin('login-pin')
        caricaOperaiAzienda(az.id)
      })
      lista.appendChild(card)
    })
  }

  // Carica gli operai di una specifica azienda e li mostra come chip selezionabili.
  // L'operaio deve prima selezionare il proprio nome, poi inserire il PIN.
  // Mostra tutti i ruoli — la distinzione visiva avviene dopo il login.
  async function caricaOperaiAzienda(companyId) {
    const { data, error } = await db
      .from('operai')
      .select('id, nome, ruolo')
      .eq('company_id', companyId)
    if (error || !data) return

    const lista = document.getElementById('login-operai-lista')
    lista.innerHTML = ''
    data.forEach(function(op) {
      const chip = document.createElement('div')
      chip.className = 'chip-operaio'
      chip.textContent = op.nome
      chip.dataset.id = op.id
      chip.dataset.nome = op.nome
      chip.dataset.ruolo = op.ruolo
      chip.addEventListener('click', function() {
        document.querySelectorAll('.chip-operaio').forEach(function(c) {
          c.classList.remove('selezionato')
        })
        chip.classList.add('selezionato')
        operaioInLogin = { id: op.id, nome: op.nome, ruolo: op.ruolo }
        pinBuffer = ''
        aggiornaDisplay()
        document.getElementById('pin-errore').style.display = 'none'
      })
      lista.appendChild(chip)
    })
  }

  // ── VERIFICA PIN E AUTENTICAZIONE ──────────────────────────────────

  // Verifica il PIN inserito confrontandolo con il valore in Supabase.
  // NOTA SICUREZZA: il PIN è confrontato lato client. In produzione
  // questa verifica deve avvenire lato server tramite Supabase Auth o RPC.
  //
  // Dopo verifica riuscita:
  // - Assegna l'operaio allo slot disponibile (1 o 2)
  // - Per supervisore/titolare: aggiorna aziendaSelezionata con la loro azienda
  //   (non quella del tablet) per garantire il filtro corretto sui dati
  // - Chiama avviaPerRuolo() per mostrare la schermata corretta
  async function verificaPin() {
    if (!operaioInLogin) {
      mostraNotifica('Seleziona prima il tuo nome.')
      resetPin()
      return
    }

    const { data, error } = await db
      .from('operai')
      .select('id, nome, ruolo, pin, company_id')
      .eq('id', operaioInLogin.id)
      .single()

    if (error || !data || data.pin !== pinBuffer) {
      document.getElementById('pin-errore').style.display = 'block'
      resetPin()
      return
    }

    const operaio = { id: data.id, nome: data.nome, ruolo: data.ruolo }

    // Gestione slot: primo slot libero disponibile, altrimenti sovrascrive slot1
    if (!slot1) { slot1 = operaio; slotAttivo = 1 }
    else if (!slot2) { slot2 = operaio; slotAttivo = 2 }
    else { slot1 = operaio; slotAttivo = 1 }

    // Supervisore e titolare vedono i dati della propria azienda,
    // non quella memorizzata nel localStorage del tablet
    if (data.ruolo === 'supervisore' || data.ruolo === 'titolare') {
      const { data: azData } = await db
        .from('companies')
        .select('id, name')
        .eq('id', data.company_id)
        .single()

      if (azData) {
        aziendaSelezionata = { id: azData.id, name: azData.name }
      }
    }

    operaioCorrente = operaio
    resetPin()
    nascondiLogin()
    aggiornaBarraUtenti()
    avviaPerRuolo(operaio)
  }

  // Instrada l'utente alla schermata corretta in base al suo ruolo.
  // Gestisce anche la visibilità della card "Supervisore" in home:
  // - operaio: card supervisore nascosta
  // - supervisore: card supervisore visibile
  function avviaPerRuolo(operaio) {
    if (operaio.ruolo === 'operaio') {
      mostraSchermata('schermata-home')
      impostaData()
      caricaGuide()
      document.querySelector('.card-categoria.supervisore').style.display = 'none'
      document.querySelector('.card-categoria.proponi').style.display = 'flex'
    } else if (operaio.ruolo === 'supervisore') {
      mostraSchermata('schermata-supervisore')
      impostaData()
      caricaGuide()
      caricaVistaSupervisore()
      document.querySelector('.card-categoria.supervisore').style.display = 'flex'
    } else if (operaio.ruolo === 'titolare') {
      mostraSchermata('schermata-titolare')
      impostaData()
      caricaDashboardTitolare()
    } else if (operaio.ruolo === 'admin') {
      mostraSchermata('schermata-admin')
      document.getElementById('admin-sezione-operai').style.display = 'none'
      impostaData()
      caricaPannelloAdmin()
    }
  }

  // ── BARRA UTENTI (MULTI-SLOT) ──────────────────────────────────────

  // Aggiorna la barra in basso con i due slot utente.
  // - Slot occupato: mostra iniziale del nome e avatar verde
  // - Slot vuoto: mostra "+" per aggiungere un secondo utente
  // - Click su slot occupato: cambia utente e ripristina la sua sessione
  // - Click su slot vuoto: apre il login per aggiungere un secondo utente
  function aggiornaBarraUtenti() {
    const barra = document.getElementById('barra-utenti')
    barra.style.display = 'flex'

    function iniziale(nome) {
      return nome ? nome.charAt(0).toUpperCase() : '?'
    }

    const avatar1 = document.getElementById('avatar-1')
    const nome1 = document.getElementById('nome-1')
    const avatar2 = document.getElementById('avatar-2')
    const nome2 = document.getElementById('nome-2')
    const slotEl1 = document.getElementById('slot-1')
    const slotEl2 = document.getElementById('slot-2')

    if (slot1) {
      avatar1.textContent = iniziale(slot1.nome)
      nome1.textContent = slot1.nome.split(' ')[0]
      avatar1.style.background = '#0F766E'
    } else {
      avatar1.textContent = '+'
      nome1.textContent = 'Aggiungi'
      avatar1.style.background = '#374151'
    }

    if (slot2) {
      avatar2.textContent = iniziale(slot2.nome)
      nome2.textContent = slot2.nome.split(' ')[0]
      avatar2.style.background = '#0F766E'
    } else {
      avatar2.textContent = '+'
      nome2.textContent = 'Aggiungi'
      avatar2.style.background = '#374151'
    }

    slotEl1.classList.toggle('attivo', slotAttivo === 1)
    slotEl2.classList.toggle('attivo', slotAttivo === 2)

    // Click slot 1: salva stato corrente, passa a slot 1
    slotEl1.onclick = function() {
      if (!slot1) {
        apriLoginPerSlot(1)
      } else {
        // Salva lo stato dello slot corrente prima di cambiare
        statoSlot[slotAttivo].esecuzioneId = esecuzioneId
        statoSlot[slotAttivo].guida = guidaCorrente || null
        slotAttivo = 1
        operaioCorrente = slot1
        esecuzioneId = statoSlot[1].esecuzioneId
        aggiornaBarraUtenti()
        // Se l'utente stava seguendo una guida, riprendila da dove era
        if (statoSlot[1].guida) {
          riprendiGuida(statoSlot[1].guida)
        } else {
          avviaPerRuolo(slot1)
        }
      }
    }

    // Click slot 2: salva stato corrente, passa a slot 2
    slotEl2.onclick = function() {
      if (!slot2) {
        apriLoginPerSlot(2)
      } else {
        statoSlot[slotAttivo].esecuzioneId = esecuzioneId
        statoSlot[slotAttivo].guida = guidaCorrente || null
        slotAttivo = 2
        operaioCorrente = slot2
        esecuzioneId = statoSlot[2].esecuzioneId
        aggiornaBarraUtenti()
        if (statoSlot[2].guida) {
          riprendiGuida(statoSlot[2].guida)
        } else {
          avviaPerRuolo(slot2)
        }
      }
    }
  }

  // Apre il login per aggiungere un secondo utente a uno slot specifico.
  // Azzera lo slot richiesto e mostra la tastiera PIN senza cambiare azienda.
  function apriLoginPerSlot(slot) {
    slot1 = slot === 1 ? null : slot1
    slot2 = slot === 2 ? null : slot2
    slotAttivo = slot
    resetPin()
    operaioInLogin = null
    document.querySelectorAll('.chip-operaio').forEach(function(c) {
      c.classList.remove('selezionato')
    })
    document.getElementById('app').style.display = 'none'
    mostraSchermataLogin('login-pin')
    caricaOperaiAzienda(aziendaSelezionata.id)
  }

  // ── TASTIERA PIN ──────────────────────────────────────────────────

  // Flag che blocca la tastiera mentre la verifica PIN è in corso (async).
  // Evita che l'utente prema altri tasti durante la chiamata a Supabase.
  let verificaInCorso = false

  // Azzera completamente lo stato della tastiera PIN.
  function resetPin() {
    pinBuffer = ''
    verificaInCorso = false
    for (let i = 1; i <= 4; i++) {
      const dot = document.getElementById('dot-' + i)
      if (dot) dot.classList.remove('attivo')
    }
  }

  // Aggiorna i pallini visuali del PIN in base alle cifre inserite.
  function aggiornaDisplay() {
    for (let i = 1; i <= 4; i++) {
      const dot = document.getElementById('dot-' + i)
      if (dot) dot.classList.toggle('attivo', i <= pinBuffer.length)
    }
  }

  // Listener unico sulla tastiera tramite event delegation.
  // Il bottone cancella viene gestito PRIMA del check su data-n per evitare
  // il bug di blocco quando si cancella dopo 4 cifre inserite.
  document.getElementById('tastiera-pin').addEventListener('click', function(e) {
    const btn = e.target.closest('.tasto-pin')
    if (!btn) return
    if (verificaInCorso) return

    if (btn.id === 'btn-cancella') {
      if (pinBuffer.length > 0) {
        pinBuffer = pinBuffer.slice(0, -1)
        aggiornaDisplay()
        document.getElementById('pin-errore').style.display = 'none'
      }
      return
    }

    const n = btn.dataset.n
    if (n === undefined || n === '') return

    if (pinBuffer.length < 4) {
      pinBuffer += n
      aggiornaDisplay()
      // Quando si raggiungono 4 cifre, avvia la verifica con un breve ritardo
      // per permettere l'animazione visiva dell'ultimo pallino
      if (pinBuffer.length === 4) {
        verificaInCorso = true
        setTimeout(verificaPin, 150)
      }
    }
  })

  // Bottone "Cambia officina": rimuove l'azienda dal localStorage
  // e torna alla schermata di selezione azienda.
  document.getElementById('btn-cambia-azienda').addEventListener('click', function() {
    localStorage.removeItem('azienda_id')
    localStorage.removeItem('azienda_nome')
    aziendaSelezionata = null
    resetPin()
    mostraSchermataLogin('login-azienda')
    caricaAziende()
  })

  // ── HOME OPERAIO — GUIDE RECENTI ──────────────────────────────────

  // Aggiunge una guida alla lista delle recenti (max 3).
  // Le recenti sono in memoria — si resettano al ricaricamento della pagina.
  function aggiungiRecente(guida) {
    guidheRecenti = guidheRecenti.filter(function(g) { return g.id !== guida.id })
    guidheRecenti.unshift(guida)
    if (guidheRecenti.length > 3) guidheRecenti = guidheRecenti.slice(0, 3)
    mostraRecenti()
  }

  // Renderizza la sezione "Hai usato di recente" nella home.
  // Se vuota, la sezione viene nascosta completamente.
  function mostraRecenti() {
    if (guidheRecenti.length === 0) {
      document.getElementById('sezione-recenti').style.display = 'none'
      return
    }
    document.getElementById('sezione-recenti').style.display = 'block'
    const lista = document.getElementById('lista-recenti')
    lista.innerHTML = ''
    guidheRecenti.forEach(function(guida) {
      const card = document.createElement('div')
      card.className = 'card-recente'
      card.innerHTML = '<span>' + guida.titolo + '</span><span class="freccia">›</span>'
      card.addEventListener('click', function() { apriGuida(guida) })
      lista.appendChild(card)
    })
  }

  // ── PROPOSTA NUOVA GUIDA ──────────────────────────────────────────

  // Contatore per numerare gli step nel form di proposta guida.
  let stepFormCount = 0

  // Aggiunge dinamicamente un blocco step nel form di proposta guida.
  // Ogni step ha: testo, note, criticità (select), foto (file input).
  // Il pulsante Rimuovi chiede conferma prima di eliminare lo step.
  function aggiungiStepForm() {
    stepFormCount++
    const contenitore = document.getElementById('lista-step-form')
    const blocco = document.createElement('div')
    blocco.className = 'step-form-blocco'
    blocco.id = 'step-form-' + stepFormCount
    blocco.innerHTML =
      '<div class="step-form-numero">Step ' + stepFormCount + '</div>' +
      '<input type="text" placeholder="Descrivi l\'azione..." class="step-form-testo">' +
      '<textarea placeholder="Note (opzionale)..." class="step-form-note"></textarea>' +
      '<select class="step-form-criticita">' +
        '<option value="">Criticità...</option>' +
        '<option value="Bassa">Bassa</option>' +
        '<option value="Media">Media</option>' +
        '<option value="Alta">Alta</option>' +
      '</select>' +
      '<label class="form-label" style="margin-top:8px">Foto di riferimento (opzionale)</label>' +
      '<input type="file" class="step-form-foto" accept="image/*" style="margin-bottom:8px">' +
      '<button class="btn-rimuovi-step" data-id="' + stepFormCount + '">Rimuovi step</button>'
    contenitore.appendChild(blocco)

    blocco.querySelector('.btn-rimuovi-step').addEventListener('click', function() {
      if (confirm('Vuoi rimuovere questo step?')) {
        blocco.remove()
      }
    })
  }

  // Salva una nuova guida proposta su Supabase con approvata=false.
  // Il supervisore la vedrà nella sezione "Guide in bozza" e potrà approvarla.
  // Le foto degli step vengono caricate su Supabase Storage (bucket: guide-photos).
  // Il company_id viene preso dalla prima guida esistente — TODO: usare aziendaSelezionata.id
  async function salvaGuida() {
    const titolo = document.getElementById('input-titolo').value.trim()
    const categoria = document.getElementById('input-categoria').value
    const descrizione = document.getElementById('input-descrizione').value.trim()

    if (!titolo || !categoria) {
      mostraNotifica('Titolo e categoria sono obbligatori.')
      return
    }

    const stepBlocchi = document.querySelectorAll('.step-form-blocco')
    if (stepBlocchi.length === 0) {
      mostraNotifica('Aggiungi almeno uno step.')
      return
    }

    const steps = []
    let ordine = 1
    let valido = true

    stepBlocchi.forEach(function(blocco) {
      const testo = blocco.querySelector('.step-form-testo').value.trim()
      const note = blocco.querySelector('.step-form-note').value.trim()
      const criticita = blocco.querySelector('.step-form-criticita').value
      if (!testo) { valido = false; return }
      steps.push({ testo: testo, note: note, criticita: criticita, ordine: ordine })
      ordine++
    })

    if (!valido) {
      mostraNotifica('Compila il testo di tutti gli step.')
      return
    }

    // Inserisce la guida come bozza (approvata=false)
    const { data: guidaData, error: guidaError } = await db
      .from('guide')
      .insert({
        titolo: titolo,
        categoria: categoria,
        descrizione: descrizione,
        created_by: operaioCorrente ? operaioCorrente.nome : 'Sconosciuto',
        approvata: false,
        company_id: aziendaSelezionata ? aziendaSelezionata.id : null
      })
      .select()

    if (guidaError) {
      console.error('Errore salvataggio guida:', guidaError.message)
      mostraNotifica('Errore nel salvataggio. Riprova.')
      return
    }

    const guidaId = guidaData[0].id

    // Inserisce gli step uno alla volta (con eventuale upload foto)
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      let fotoUrl = null

      const fileInput = document.querySelectorAll('.step-form-foto')[i]
      if (fileInput && fileInput.files[0]) {
        const file = fileInput.files[0]
        const nomeFile = guidaId + '-step' + s.ordine + '-' + Date.now() + '.' + file.name.split('.').pop()
        const { error: uploadError } = await db.storage
          .from('guide-photos')
          .upload(nomeFile, file)
        if (!uploadError) {
          fotoUrl = nomeFile
        }
      }

      const { error: stepError } = await db
        .from('steps')
        .insert({
          guide_id: guidaId,
          ordine: s.ordine,
          testo: s.testo,
          note: s.note || null,
          'criticità': s.criticita || null,
          immagine_rif_url: fotoUrl
        })

      if (stepError) {
        console.error('Errore salvataggio step:', stepError.message)
      }
    }

    // Reset del form
    document.getElementById('input-titolo').value = ''
    document.getElementById('input-categoria').value = ''
    document.getElementById('input-descrizione').value = ''
    document.getElementById('lista-step-form').innerHTML = ''
    stepFormCount = 0

    mostraNotifica('Guida inviata per approvazione.')
    mostraSchermata('schermata-home')
  }

  // ── VISTA SUPERVISORE ─────────────────────────────────────────────

  // Carica tutte le sezioni della vista supervisore in sequenza.
  // Tutte le query filtrano per azienda tramite company_id delle guide.
  async function caricaVistaSupervisore() {
    await caricaErroriAperti()
    await caricaBozze()
    await caricaAttivitaRecente()
    await caricaSuggerimenti()
  }

  // ── DASHBOARD TITOLARE ────────────────────────────────────────────

  // Dashboard read-only per il titolare. Mostra:
  // - 4 card con contatori (oggi/settimana/mese/guide attive)
  // - Grafico a barre degli ultimi 7 giorni
  // - Top 3 operai più attivi della settimana
  // - Numero errori aperti (con colore rosso se > 0)
  //
  // Tutte le statistiche sono filtrate per l'azienda del titolare.
  async function caricaDashboardTitolare() {
    const oggi = new Date()
    const inizioOggi = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate()).toISOString()
    const inizioSettimana = new Date(oggi.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const inizioMese = new Date(oggi.getFullYear(), oggi.getMonth(), 1).toISOString()

    document.getElementById('titolare-data').textContent =
      oggi.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

    const companyId = aziendaSelezionata.id

    // Recupera gli ID delle guide dell'azienda per filtrare le executions
    // (executions non ha company_id diretto, è collegata tramite guide)
    const { data: guideIds } = await db
      .from('guide')
      .select('id')
      .eq('company_id', aziendaSelezionata.id)

    const ids = guideIds ? guideIds.map(function(g) { return g.id }) : []

    // UUID fittizio usato come fallback per .in() quando non ci sono guide
    // evita errori Supabase con array vuoto
    const { data: tutteExec } = await db
      .from('executions')
      .select('id, stato, data_fine, data_inizio, user_id, operaio:user_id(nome)')
      .eq('stato', 'completata')
      .in('guide_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
      .gte('data_fine', inizioMese)

    const completateOggi = tutteExec ? tutteExec.filter(function(e) {
      return e.data_fine >= inizioOggi
    }).length : 0

    const completateSettimana = tutteExec ? tutteExec.filter(function(e) {
      return e.data_fine >= inizioSettimana
    }).length : 0

    const completateMese = tutteExec ? tutteExec.length : 0

    const { data: guideData } = await db
      .from('guide')
      .select('id')
      .eq('company_id', companyId)
      .eq('approvata', true)

    const numGuide = guideData ? guideData.length : 0

    const { data: erroriData } = await db
      .from('error_log')
      .select('id')
      .eq('stato', 'aperto')
      .in('guide_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])

    const numErrori = erroriData ? erroriData.length : 0

    // Renderizza le 4 card statistiche
    document.getElementById('titolare-cards').innerHTML =
      '<div class="titolare-card-grid">' +
        '<div class="titolare-card"><div class="numero">' + completateOggi + '</div><div class="etichetta">Completate oggi</div></div>' +
        '<div class="titolare-card"><div class="numero">' + completateSettimana + '</div><div class="etichetta">Questa settimana</div></div>' +
        '<div class="titolare-card"><div class="numero">' + completateMese + '</div><div class="etichetta">Questo mese</div></div>' +
        '<div class="titolare-card"><div class="numero">' + numGuide + '</div><div class="etichetta">Guide attive</div></div>' +
      '</div>'

    // Costruisce il grafico a barre degli ultimi 7 giorni
    const giorni = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(oggi.getTime() - i * 24 * 60 * 60 * 1000)
      const inizio = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
      const fine = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString()
      const count = tutteExec ? tutteExec.filter(function(e) {
        return e.data_fine >= inizio && e.data_fine < fine
      }).length : 0
      giorni.push({
        label: d.toLocaleDateString('it-IT', { weekday: 'short' }),
        count: count
      })
    }

    const maxVal = Math.max(...giorni.map(function(g) { return g.count }), 1)
    const grafico = document.getElementById('grafico-completate')
    grafico.innerHTML = giorni.map(function(g) {
      const altezza = Math.round((g.count / maxVal) * 90)
      return '<div class="barra-giorno">' +
        '<div class="barra-numero">' + (g.count > 0 ? g.count : '') + '</div>' +
        '<div class="barra" style="height:' + altezza + 'px"></div>' +
        '<div class="barra-label">' + g.label + '</div>' +
      '</div>'
    }).join('')

    // Calcola top 3 operai per guide completate questa settimana
    const operaiMap = {}
    if (tutteExec) {
      tutteExec.filter(function(e) { return e.data_fine >= inizioSettimana }).forEach(function(e) {
        if (!e.operaio) return
        const nome = e.operaio.nome
        if (!operaiMap[nome]) operaiMap[nome] = 0
        operaiMap[nome]++
      })
    }

    const operaiOrdinati = Object.entries(operaiMap).sort(function(a, b) { return b[1] - a[1] }).slice(0, 3)
    const listOp = document.getElementById('titolare-operai')

    if (operaiOrdinati.length === 0) {
      listOp.innerHTML = '<p class="vuoto-messaggio">Nessuna attività questa settimana</p>'
    } else {
      listOp.innerHTML = operaiOrdinati.map(function(entry, i) {
        const medaglie = ['🥇', '🥈', '🥉']
        return '<div class="card-operaio-attivo">' +
          '<div class="operaio-avatar-sm">' + entry[0].charAt(0) + '</div>' +
          '<div class="operaio-info">' +
            '<div class="nome">' + entry[0] + '</div>' +
            '<div class="completate">' + entry[1] + ' guide completate</div>' +
          '</div>' +
          '<div class="operaio-badge">' + (medaglie[i] || '') + '</div>' +
        '</div>'
      }).join('')
    }

    // Card errori: verde se zero, rossa se ci sono errori aperti
    const classeErrori = numErrori === 0 ? 'zero' : 'alcuni'
    document.getElementById('titolare-errori').innerHTML =
      '<div class="titolare-errore-numero ' + classeErrori + '">' +
        numErrori +
        '<span class="sub">' + (numErrori === 0 ? 'Nessun errore aperto 🎉' : 'errori aperti da risolvere') + '</span>' +
      '</div>'
  }

  // ── PANNELLO ADMIN ────────────────────────────────────────────────

  // Carica tutte le aziende con conteggio operai e guide attive.
  // Per ogni azienda mostra un pulsante elimina (con conferma) e
  // al click apre la sezione degli operai di quella azienda.
  //
  // NOTA: il ruolo admin è globale e non legato a una specifica azienda.
  // L'operaio admin appare nella lista di Officina Ferretti ma può
  // gestire tutte le aziende del sistema.
  async function caricaPannelloAdmin() {
    const { data, error } = await db
      .from('companies')
      .select('id, name')
      .order('name')

    if (error || !data) return

    const lista = document.getElementById('admin-lista-aziende')
    lista.innerHTML = ''

    for (const az of data) {
      const { count: numOperai } = await db
        .from('operai')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', az.id)

      const { count: numGuide } = await db
        .from('guide')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', az.id)
        .eq('approvata', true)

      const card = document.createElement('div')
      card.className = 'card-admin-azienda'
      card.innerHTML =
        '<div>' +
          '<div class="az-nome">' + az.name + '</div>' +
          '<div class="az-meta">' + (numOperai || 0) + ' operai · ' + (numGuide || 0) + ' guide attive</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<button class="btn-elimina-az" data-id="' + az.id + '" data-nome="' + az.name + '">🗑</button>' +
          '<span style="color:#9CA3AF;font-size:20px">›</span>' +
        '</div>'

      card.addEventListener('click', function() {
        adminAziendaSelezionata = az
        document.getElementById('admin-nome-azienda').textContent = az.name
        document.getElementById('admin-sezione-operai').style.display = 'block'
        caricaOperaiAdmin(az.id)
      })
      lista.appendChild(card)

      // Elimina azienda: cancella prima guide e operai (cascata manuale)
      // poi elimina l'azienda stessa. Operazione irreversibile.
      card.querySelector('.btn-elimina-az').addEventListener('click', async function(e) {
        e.stopPropagation()
        const nome = this.dataset.nome
        if (!confirm('Eliminare ' + nome + '? Verranno eliminati tutti gli operai e le guide associate.')) return
        const azId = this.dataset.id
        await db.from('guide').delete().eq('company_id', azId)
        await db.from('operai').delete().eq('company_id', azId)
        const { error } = await db.from('companies').delete().eq('id', azId)
        if (error) { mostraNotifica('Errore durante l\'eliminazione.'); return }
        mostraNotifica('Azienda eliminata.')
        document.getElementById('admin-sezione-operai').style.display = 'none'
        caricaPannelloAdmin()
      })
    }
  }

  // Carica gli operai di una specifica azienda nel pannello admin.
  // Mostra nome, ruolo (con colore) e pulsanti Modifica/Elimina.
  async function caricaOperaiAdmin(companyId) {
    const { data, error } = await db
      .from('operai')
      .select('id, nome, email, ruolo, pin')
      .eq('company_id', companyId)
      .order('nome')

    const lista = document.getElementById('admin-lista-operai')

    if (error || !data || data.length === 0) {
      lista.innerHTML = '<p class="vuoto-messaggio">Nessun operaio in questa azienda</p>'
      return
    }

    lista.innerHTML = ''
    data.forEach(function(op) {
      const card = document.createElement('div')
      card.className = 'card-admin-operaio'
      card.innerHTML =
        '<div class="op-header">' +
          '<span class="op-nome">' + op.nome + '</span>' +
          '<span class="op-ruolo ' + op.ruolo + '">' + op.ruolo + '</span>' +
        '</div>' +
        '<div class="op-azioni">' +
          '<button class="btn-modifica-op" data-id="' + op.id + '">✏️ Modifica</button>' +
          '<button class="btn-elimina-op" data-id="' + op.id + '">🗑 Elimina</button>' +
        '</div>'
      lista.appendChild(card)
    })

    // Modifica: precompila il modale con i dati dell'operaio selezionato
    document.querySelectorAll('.btn-modifica-op').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const op = data.find(function(o) { return o.id === this.dataset.id }.bind(this))
        if (!op) return
        operaioInModifica = op
        document.getElementById('modale-op-titolo').textContent = 'Modifica operaio'
        document.getElementById('input-op-nome').value = op.nome
        document.getElementById('input-op-email').value = op.email || ''
        document.getElementById('input-op-pin').value = op.pin || ''
        document.getElementById('input-op-ruolo').value = op.ruolo
        document.getElementById('modale-nuovo-operaio').style.display = 'block'
      })
    })

    document.querySelectorAll('.btn-elimina-op').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (!confirm('Eliminare questo operaio? L\'operazione è irreversibile.')) return
        const { error } = await db.from('operai').delete().eq('id', this.dataset.id)
        if (error) { mostraNotifica('Errore durante l\'eliminazione.'); return }
        mostraNotifica('Operaio eliminato.')
        caricaOperaiAdmin(adminAziendaSelezionata.id)
      })
    })
  }

  // Salva una nuova azienda in Supabase.
  async function salvaAzienda() {
    const nome = document.getElementById('input-az-nome').value.trim()
    if (!nome) { mostraNotifica('Inserisci il nome dell\'azienda.'); return }

    const { error } = await db.from('companies').insert({ name: nome })
    if (error) { console.error(error); mostraNotifica('Errore nel salvataggio.'); return }

    document.getElementById('input-az-nome').value = ''
    document.getElementById('modale-nuova-azienda').style.display = 'none'
    mostraNotifica('Azienda creata.')
    caricaPannelloAdmin()
  }

  // Salva un operaio nuovo o aggiorna uno esistente (se operaioInModifica è impostato).
  // Validazione: nome e PIN 4 cifre obbligatori.
  async function salvaOperaio() {
    const nome = document.getElementById('input-op-nome').value.trim()
    const email = document.getElementById('input-op-email').value.trim()
    const pin = document.getElementById('input-op-pin').value.trim()
    const ruolo = document.getElementById('input-op-ruolo').value

    if (!nome || !pin || pin.length !== 4) {
      mostraNotifica('Nome e PIN a 4 cifre sono obbligatori.')
      return
    }

    if (operaioInModifica) {
      const { error } = await db
        .from('operai')
        .update({ nome: nome, email: email, pin: pin, ruolo: ruolo })
        .eq('id', operaioInModifica.id)
      if (error) { mostraNotifica('Errore nel salvataggio.'); return }
      mostraNotifica('Operaio aggiornato.')
    } else {
      const { error } = await db
        .from('operai')
        .insert({
          company_id: adminAziendaSelezionata.id,
          nome: nome,
          email: email,
          pin: pin,
          ruolo: ruolo
        })
      if (error) { mostraNotifica('Errore nel salvataggio.'); return }
      mostraNotifica('Operaio aggiunto.')
    }

    operaioInModifica = null
    document.getElementById('modale-nuovo-operaio').style.display = 'none'
    caricaOperaiAdmin(adminAziendaSelezionata.id)
  }

  // Listener modali admin
  document.getElementById('btn-nuova-azienda').addEventListener('click', function() {
    document.getElementById('input-az-nome').value = ''
    document.getElementById('modale-nuova-azienda').style.display = 'block'
  })
  document.getElementById('btn-salva-azienda').addEventListener('click', salvaAzienda)
  document.getElementById('btn-annulla-azienda').addEventListener('click', function() {
    document.getElementById('modale-nuova-azienda').style.display = 'none'
  })
  document.getElementById('sfondo-modale-az').addEventListener('click', function() {
    document.getElementById('modale-nuova-azienda').style.display = 'none'
  })
  document.getElementById('btn-nuovo-operaio').addEventListener('click', function() {
    operaioInModifica = null
    document.getElementById('modale-op-titolo').textContent = 'Nuovo operaio'
    document.getElementById('input-op-nome').value = ''
    document.getElementById('input-op-email').value = ''
    document.getElementById('input-op-pin').value = ''
    document.getElementById('input-op-ruolo').value = 'operaio'
    document.getElementById('modale-nuovo-operaio').style.display = 'block'
  })
  document.getElementById('btn-salva-operaio').addEventListener('click', salvaOperaio)
  document.getElementById('btn-annulla-operaio').addEventListener('click', function() {
    document.getElementById('modale-nuovo-operaio').style.display = 'none'
    operaioInModifica = null
  })
  document.getElementById('sfondo-modale-op').addEventListener('click', function() {
    document.getElementById('modale-nuovo-operaio').style.display = 'none'
    operaioInModifica = null
  })

  // ── VISTA SUPERVISORE — ERRORI APERTI ────────────────────────────

  // Carica gli errori aperti filtrati per azienda (tramite guide_id → company_id).
  // Il supervisore può segnare un errore come risolto con una nota di chiusura.
  // NOTA: gli errori devono essere salvati con guide_id valorizzato (vedi inviaErrore).
  async function caricaErroriAperti() {
    const { data: guideIds } = await db
      .from('guide')
      .select('id')
      .eq('company_id', aziendaSelezionata.id)

    const ids = guideIds ? guideIds.map(function(g) { return g.id }) : []

    const { data, error } = await db
      .from('error_log')
      .select('id, tipo_errore, descrizione, created_at, step_id')
      .eq('stato', 'aperto')
      .in('guide_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false })

    const lista = document.getElementById('lista-errori-aperti')

    if (error || !data || data.length === 0) {
      lista.innerHTML = '<p class="vuoto-messaggio">Nessun errore aperto 🎉</p>'
      return
    }

    lista.innerHTML = ''
    data.forEach(function(errore) {
      const card = document.createElement('div')
      card.className = 'card-errore'
      const data_fmt = new Date(errore.created_at).toLocaleDateString('it-IT')
      card.innerHTML =
        '<div class="errore-meta">' + data_fmt + ' — ' + (errore.tipo_errore || 'generico') + '</div>' +
        '<div class="errore-descrizione">' + errore.descrizione + '</div>' +
        '<button class="btn-chiudi-errore" data-id="' + errore.id + '">✓ Segna come risolto</button>'
      lista.appendChild(card)
    })

    document.querySelectorAll('.btn-chiudi-errore').forEach(function(btn) {
      btn.addEventListener('click', function() {
        chiudiErrore(this.dataset.id)
      })
    })
  }

  // Chiude un errore con nota opzionale. Il prompt nativo è usato per semplicità —
  // in produzione sostituire con un modale come quello della segnalazione.
  // Se l'utente preme Annulla (nota === null), l'operazione viene annullata.
  async function chiudiErrore(id) {
    const nota = prompt('Aggiungi una nota di chiusura (opzionale):')
    if (nota === null) return

    const { error } = await db
      .from('error_log')
      .update({
        stato: 'risolto',
        note_chiusura: nota || '',
        chiuso_da: operaioCorrente ? operaioCorrente.nome : 'supervisore',
        data_chiusura: new Date().toISOString()
      })
      .eq('id', id)

    if (error) {
      console.error('Errore chiusura:', error.message)
      return
    }

    mostraNotifica('Errore segnato come risolto.')
    caricaErroriAperti()
  }

  // ── VISTA SUPERVISORE — GUIDE IN BOZZA ───────────────────────────

  // Carica le guide non ancora approvate dell'azienda corrente.
  // Per ogni bozza il supervisore può: vedere (anteprima step), approvare, eliminare.
  async function caricaBozze() {
    const { data, error } = await db
      .from('guide')
      .select('id, titolo, categoria')
      .eq('approvata', false)
      .eq('company_id', aziendaSelezionata.id)
      .order('created_at', { ascending: false })

    const lista = document.getElementById('lista-bozze')

    if (error || !data || data.length === 0) {
      lista.innerHTML = '<p class="vuoto-messaggio">Nessuna guida in bozza</p>'
      return
    }

    lista.innerHTML = ''
    data.forEach(function(guida) {
      const card = document.createElement('div')
      card.className = 'card-bozza'
      card.innerHTML =
        '<span>' + guida.titolo + '</span>' +
        '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn-anteprima-bozza" data-id="' + guida.id + '" data-titolo="' + guida.titolo + '">👁 Vedi</button>' +
        '<button class="btn-approva" data-id="' + guida.id + '">✓ Approva</button>' +
        '<button class="btn-elimina-guida" data-id="' + guida.id + '">🗑 Elimina</button>' +
        '</div>'
      lista.appendChild(card)
    })

    document.querySelectorAll('.btn-approva').forEach(function(btn) {
      btn.addEventListener('click', function() { approvaGuida(this.dataset.id) })
    })
    document.querySelectorAll('.btn-anteprima-bozza').forEach(function(btn) {
      btn.addEventListener('click', function() {
        apriAnteprimaBozza(this.dataset.id, this.dataset.titolo)
      })
    })
    document.querySelectorAll('.btn-elimina-guida').forEach(function(btn) {
      btn.addEventListener('click', function() { eliminaGuida(this.dataset.id) })
    })
  }

  // Approva una guida: imposta approvata=true → diventa visibile agli operai.
  async function approvaGuida(id) {
    const { error } = await db
      .from('guide')
      .update({ approvata: true })
      .eq('id', id)

    if (error) {
      console.error('Errore approvazione:', error.message)
      return
    }

    mostraNotifica('Guida approvata — ora visibile agli operai.')
    caricaBozze()
    caricaGuide()
  }

  // Mostra l'anteprima degli step di una guida in bozza nella schermata step.
  // In modalità anteprima: nessun bottone "Completato", nessuna sessione.
  // Il pulsante "Torna" riporta alla vista supervisore invece che alla lista guide.
  async function apriAnteprimaBozza(guidaId, titolo) {
    document.getElementById('titolo-guida').textContent = titolo + ' (bozza)'

    const { data, error } = await db
      .from('steps')
      .select('id, ordine, testo, note, criticità, immagine_rif_url')
      .eq('guide_id', guidaId)
      .order('ordine', { ascending: true })

    if (error) {
      console.error('Errore caricamento step:', error.message)
      return
    }

    const lista = document.getElementById('lista-step')
    lista.innerHTML = ''

    data.forEach(function(step) {
      const blocco = document.createElement('div')
      blocco.className = 'blocco-step'
      blocco.id = 'step-' + step.id
      const classeCriticita = step['criticità'] ? 'critica-' + step['criticità'].toLowerCase() : ''
      blocco.innerHTML =
        '<div class="step-numero">' + step.ordine + '</div>' +
        '<div class="step-contenuto ' + classeCriticita + '">' +
        '<span class="badge-criticita ' + (step['criticità'] ? step['criticità'].toLowerCase() : '') + '">' + (step['criticità'] || '') + '</span>' +
        '<p class="step-testo">' + step.testo + '</p>' +
        (step.note ? '<p class="step-note">' + step.note + '</p>' : '') +
        (step.immagine_rif_url ? '<img class="step-foto" src="https://ggnjiemcqcwlzgtojnyy.supabase.co/storage/v1/object/public/guide-photos/' + step.immagine_rif_url + '">' : '') +
        '</div>'
      lista.appendChild(blocco)
    })

    // Modalità anteprima: nasconde chiudi sessione e modifica il comportamento di "Torna"
    document.getElementById('btn-chiudi-sessione').style.display = 'none'
    document.getElementById('btn-torna').textContent = '← Torna al supervisore'
    document.getElementById('btn-torna').onclick = function() {
      document.getElementById('btn-chiudi-sessione').style.display = 'block'
      document.getElementById('btn-torna').textContent = 'Torna alle guide'
      document.getElementById('btn-torna').onclick = null
      mostraSchermata('schermata-supervisore')
      caricaVistaSupervisore()
    }

    mostraSchermata('schermata-step')
  }

  // Elimina una guida e tutti i suoi step. Operazione irreversibile.
  async function eliminaGuida(id) {
    if (!confirm('Eliminare questa guida e tutti i suoi step? L\'operazione è irreversibile.')) return

    await db.from('steps').delete().eq('guide_id', id)

    const { error } = await db.from('guide').delete().eq('id', id)

    if (error) {
      console.error('Errore eliminazione:', error.message)
      mostraNotifica('Errore durante l\'eliminazione.')
      return
    }

    mostraNotifica('Guida eliminata.')
    caricaBozze()
    caricaGuide()
  }

  // ── VISTA SUPERVISORE — ATTIVITÀ RECENTE ─────────────────────────

  // Carica le ultime 20 esecuzioni (completate e in corso) filtrate per azienda.
  // Mostra due colonne affiancate: completate a sinistra, in corso a destra.
  // Ogni card è cliccabile e apre l'anteprima della guida corrispondente.
  async function caricaAttivitaRecente() {
    const { data: guideIds } = await db
      .from('guide')
      .select('id')
      .eq('company_id', aziendaSelezionata.id)

    const ids = guideIds ? guideIds.map(function(g) { return g.id }) : []

    const { data, error } = await db
      .from('executions')
      .select('id, stato, data_inizio, data_fine, guide_id, user_id, guide:guide_id(titolo), operaio:user_id(nome)')
      .in('stato', ['completata', 'in corso'])
      .in('guide_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
      .order('data_inizio', { ascending: false })
      .limit(20)

    const lista = document.getElementById('lista-attivita')

    if (error || !data || data.length === 0) {
      lista.innerHTML = '<p class="vuoto-messaggio">Nessuna attività recente</p>'
      return
    }

    const completate = data.filter(function(e) { return e.stato === 'completata' })
    const inCorso = data.filter(function(e) { return e.stato === 'in corso' })

    lista.innerHTML =
      '<div class="attivita-colonne">' +
        '<div class="attivita-colonna">' +
          '<h3 class="attivita-col-titolo">✓ Completate</h3>' +
          (completate.length === 0 ? '<p class="vuoto-messaggio">Nessuna</p>' :
            completate.slice(0, 5).map(function(exec) {
              const data_fmt = new Date(exec.data_fine).toLocaleDateString('it-IT')
              const minuti = Math.round((new Date(exec.data_fine) - new Date(exec.data_inizio)) / 60000)
              const nome = exec.operaio ? exec.operaio.nome : 'Operaio sconosciuto'
              const titolo = exec.guide ? exec.guide.titolo : 'Guida non trovata'
              return '<div class="card-attivita-mini completata" data-guide-id="' + exec.guide_id + '" data-titolo="' + (exec.guide ? exec.guide.titolo : '') + '" style="cursor:pointer">' +
                     '<div>' +
                     '<div class="attivita-nome">' + nome + '</div>' +
                     '<div class="attivita-guida">' + titolo + '</div>' +
                     '<div class="attivita-data">' + data_fmt + ' · ' + minuti + ' min</div>' +
                     '</div>' +
                     '</div>'
            }).join('')
          ) +
        '</div>' +
        '<div class="attivita-colonna">' +
          '<h3 class="attivita-col-titolo">⏳ In corso</h3>' +
          (inCorso.length === 0 ? '<p class="vuoto-messaggio">Nessuna</p>' :
            inCorso.slice(0, 5).map(function(exec) {
              const data_fmt = new Date(exec.data_inizio).toLocaleDateString('it-IT')
              const nome = exec.operaio ? exec.operaio.nome : 'Operaio sconosciuto'
              const titolo = exec.guide ? exec.guide.titolo : 'Guida non trovata'
              return '<div class="card-attivita-mini in-corso" data-guide-id="' + exec.guide_id + '" data-titolo="' + (exec.guide ? exec.guide.titolo : '') + '" style="cursor:pointer">' +
                     '<div>' +
                     '<div class="attivita-nome">' + nome + '</div>' +
                     '<div class="attivita-guida">' + titolo + '</div>' +
                     '<div class="attivita-data">' + data_fmt + '</div>' +
                     '</div>' +
                     '</div>'
            }).join('')
          ) +
        '</div>' +
      '</div>'

    // Click su card: apre l'anteprima degli step della guida
    document.querySelectorAll('.card-attivita-mini').forEach(function(card) {
      card.addEventListener('click', function() {
        const guidaId = this.dataset.guideId
        const titolo = this.dataset.titolo
        if (guidaId) apriAnteprimaBozza(guidaId, titolo)
      })
    })
  }

  // ── VISTA SUPERVISORE — SUGGERIMENTI OPERAI ───────────────────────

  // Carica i suggerimenti di modifica inviati dagli operai, filtrati per azienda.
  // Stato 'aperto' = da gestire. 'archiviato' = preso in carico (nascosto dalla lista).
  // I suggerimenti archiviati rimangono nel DB per la futura gamification (punteggio).
  async function caricaSuggerimenti() {
    const { data: guideIds } = await db
      .from('guide')
      .select('id')
      .eq('company_id', aziendaSelezionata.id)

    const ids = guideIds ? guideIds.map(function(g) { return g.id }) : []

    const { data, error } = await db
      .from('suggerimenti')
      .select('id, tipo, descrizione, urgenza, stato, created_at, guide_id, step_id, operaio:operaio_id(nome), guida:guide_id(titolo)')
      .eq('stato', 'aperto')
      .in('guide_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false })

    const lista = document.getElementById('lista-suggerimenti')

    if (error || !data || data.length === 0) {
      lista.innerHTML = '<p class="vuoto-messaggio">Nessun suggerimento</p>'
      return
    }

    lista.innerHTML = ''
    data.forEach(function(sug) {
      const card = document.createElement('div')
      card.className = 'card-suggerimento'
      const urgenzaColore = sug.urgenza === 'È importante' ? '#B91C1C' : '#4B5563'
      card.innerHTML =
        '<div class="sug-meta">' +
          '<span class="sug-operaio">' + (sug.operaio ? sug.operaio.nome : 'Operaio') + '</span>' +
          '<span class="sug-guida">· ' + (sug.guida ? sug.guida.titolo : '') + '</span>' +
        '</div>' +
        '<div class="sug-tipo">' + sug.tipo + '</div>' +
        '<div class="sug-descrizione">' + sug.descrizione + '</div>' +
        '<div class="sug-urgenza" style="color:' + urgenzaColore + '">' + sug.urgenza + '</div>' +
        '<button class="btn-preso-in-carico" data-id="' + sug.id + '">✓ Preso in carico</button>'
      lista.appendChild(card)
    })

    document.querySelectorAll('.btn-preso-in-carico').forEach(function(btn) {
      btn.addEventListener('click', function() { archiviaSuggerimento(this.dataset.id) })
    })
  }

  // Archivia un suggerimento (stato: aperto → archiviato).
  // Non elimina il record — serve per tracciare i contributi degli operai.
  async function archiviaSuggerimento(id) {
    const { error } = await db
      .from('suggerimenti')
      .update({ stato: 'archiviato' })
      .eq('id', id)

    if (error) {
      console.error('Errore archiviazione:', error.message)
      return
    }

    mostraNotifica('Suggerimento archiviato.')
    caricaSuggerimenti()
  }

  // ── FILTRO GUIDE ──────────────────────────────────────────────────

  // Filtra le guide per categoria attiva E testo di ricerca in tempo reale.
  // Opera sull'array tutteLeGuide in memoria, senza query aggiuntive a Supabase.
  function filtraGuide() {
    const testo = document.getElementById('cerca').value.toLowerCase()
    const filtrate = tutteLeGuide.filter(function(g) {
      const corrispondeCategoria = categoriaAttiva === 'tutte' || g.categoria === categoriaAttiva
      const corrispondeTesto = g.titolo.toLowerCase().includes(testo)
      return corrispondeCategoria && corrispondeTesto
    })
    mostraGuide(filtrate)
  }

  // Click sulle card categoria nella home.
  // - card.supervisore → schermata supervisore
  // - card.proponi → schermata proposta guida
  // - altre card → filtra per categoria nella lista guide
  document.querySelectorAll('.card-categoria').forEach(function(card) {
    card.addEventListener('click', function() {
      if (this.classList.contains('supervisore')) {
        mostraSchermata('schermata-supervisore')
        caricaVistaSupervisore()
      } else if (this.classList.contains('proponi')) {
        mostraSchermata('schermata-proponi')
      } else {
        categoriaAttiva = this.dataset.categoria
        document.getElementById('titolo-categoria').textContent = this.dataset.categoria
        mostraSchermata('schermata-lista')
        filtraGuide()
      }
    })
  })

  document.getElementById('btn-torna-home-sup').addEventListener('click', function() {
    mostraSchermata('schermata-home')
  })

  document.getElementById('btn-torna-home').addEventListener('click', function() {
    mostraSchermata('schermata-home')
  })

  // ID dell'esecuzione corrente (riga in tabella executions).
  // Viene impostato in avviaSessione() e azzerato in chiudiSessione().
  let esecuzioneId = null

  // ── NAVIGAZIONE SCHERMATE APP ─────────────────────────────────────

  // Nasconde tutte le schermate e mostra quella richiesta con animazione.
  // Da aggiornare ogni volta che si aggiunge una nuova schermata.
  function mostraSchermata(id) {
    document.getElementById('schermata-home').style.display = 'none'
    document.getElementById('schermata-lista').style.display = 'none'
    document.getElementById('schermata-step').style.display = 'none'
    document.getElementById('schermata-supervisore').style.display = 'none'
    document.getElementById('schermata-proponi').style.display = 'none'
    document.getElementById('schermata-titolare').style.display = 'none'
    document.getElementById('schermata-admin').style.display = 'none'

    const nuova = document.getElementById(id)
    nuova.style.opacity = '0'
    nuova.style.transform = 'translateY(10px)'
    nuova.style.display = 'block'
    setTimeout(function() {
      nuova.style.transition = 'all 0.3s ease'
      nuova.style.opacity = '1'
      nuova.style.transform = 'translateY(0)'
    }, 20)
  }

  // ── ESECUZIONE GUIDA ──────────────────────────────────────────────

  // Apre una guida: carica gli step da Supabase e avvia una nuova sessione.
  // Salva la guida nel statoSlot corrente per la funzione riprendiGuida().
  // Nota: criticità usa step['criticità'] con accento perché il nome
  // della colonna Supabase ha l'accento (comportamento JS con caratteri speciali).
  async function apriGuida(guida) {
    document.getElementById('titolo-guida').textContent = guida.titolo
    guidaCorrente = guida
    statoSlot[slotAttivo].guida = guida

    aggiungiRecente(guida)

    const { data, error } = await db
      .from('steps')
      .select('id, ordine, testo, note, criticità, immagine_rif_url')
      .eq('guide_id', guida.id)
      .order('ordine', { ascending: true })

    if (error) {
      console.error('Errore caricamento step:', error.message)
      return
    }

    const lista = document.getElementById('lista-step')
    lista.innerHTML = ''

    data.forEach(function(step) {
      const blocco = document.createElement('div')
      blocco.className = 'blocco-step'
      blocco.id = 'step-' + step.id
      const classeCriticita = step['criticità'] ? 'critica-' + step['criticità'].toLowerCase() : ''
      blocco.innerHTML =
        '<div class="step-numero">' + step.ordine + '</div>' +
        '<div class="step-contenuto ' + classeCriticita + '">' +
        '<span class="badge-criticita ' + (step['criticità'] ? step['criticità'].toLowerCase() : '') + '">' + (step['criticità'] || '') + '</span>' +
        '<p class="step-testo">' + step.testo + '</p>' +
        (step.note ? '<p class="step-note">' + step.note + '</p>' : '') +
        (step.immagine_rif_url ? '<img class="step-foto" src="https://ggnjiemcqcwlzgtojnyy.supabase.co/storage/v1/object/public/guide-photos/' + step.immagine_rif_url + '">' : '') +
        '<button class="btn-completato" data-id="' + step.id + '">✓ Completato</button>' +
        '<button class="btn-segnala" data-id="' + step.id + '" data-testo="' + step.testo + '">⚠ Segnala problema</button>' +
        '<button class="btn-suggerisci" data-id="' + step.id + '" data-guida="' + guida.id + '" data-testo="' + step.testo + '">✏️ Suggerisci modifica</button>' +
        '</div>'
      lista.appendChild(blocco)
    })

    document.querySelectorAll('.btn-segnala').forEach(function(btn) {
      btn.addEventListener('click', function() {
        apriModaleErrore(this.dataset.id, this.dataset.testo)
      })
    })
    document.querySelectorAll('.btn-suggerisci').forEach(function(btn) {
      btn.addEventListener('click', function() {
        apriModaleSuggerimento(this.dataset.id, this.dataset.guida, this.dataset.testo)
      })
    })
    document.querySelectorAll('.btn-completato').forEach(function(btn) {
      btn.addEventListener('click', function() {
        completaStep(this.dataset.id)
      })
    })

    mostraSchermata('schermata-step')
    avviaSessione(guida.id)
  }

  // ── RIPRESA GUIDA (MULTI-SLOT) ────────────────────────────────────

  // Riprende una guida interrotta quando si torna su uno slot.
  // Legge da Supabase quali step sono già stati completati nell'esecuzione attiva
  // e li mostra già spuntati, con il bottone disabilitato.
  //
  // Logica:
  // 1. Se esecuzioneId è già in memoria (slot tornato attivo): legge i check direttamente
  // 2. Se esecuzioneId è null: cerca l'esecuzione in corso per questo operaio+guida
  async function riprendiGuida(guida) {
    document.getElementById('titolo-guida').textContent = guida.titolo
    guidaCorrente = guida

    const { data: stepsData, error: stepsError } = await db
      .from('steps')
      .select('id, ordine, testo, note, criticità, immagine_rif_url')
      .eq('guide_id', guida.id)
      .order('ordine', { ascending: true })

    if (stepsError || !stepsData) return

    let stepsCompletati = []

    if (esecuzioneId) {
      // Caso 1: abbiamo già l'ID dell'esecuzione in memoria
      const { data: checkData } = await db
        .from('executions_checklist')
        .select('step_id')
        .eq('execution_id', esecuzioneId)
        .eq('completato', true)

      if (checkData) {
        stepsCompletati = checkData.map(function(r) { return r.step_id })
      }
    } else {
      // Caso 2: recupera l'esecuzione in corso da Supabase
      const { data: execData } = await db
        .from('executions')
        .select('id')
        .eq('guide_id', guida.id)
        .eq('user_id', operaioCorrente.id)
        .eq('stato', 'in corso')
        .order('data_inizio', { ascending: false })
        .limit(1)
        .single()

      if (execData) {
        esecuzioneId = execData.id
        statoSlot[slotAttivo].esecuzioneId = execData.id

        const { data: checkData } = await db
          .from('executions_checklist')
          .select('step_id')
          .eq('execution_id', execData.id)
          .eq('completato', true)

        if (checkData) {
          stepsCompletati = checkData.map(function(r) { return r.step_id })
        }
      }
    }

    const lista = document.getElementById('lista-step')
    lista.innerHTML = ''

    stepsData.forEach(function(step) {
      const blocco = document.createElement('div')
      blocco.className = 'blocco-step'
      blocco.id = 'step-' + step.id
      const classeCriticita = step['criticità'] ? 'critica-' + step['criticità'].toLowerCase() : ''
      const completato = stepsCompletati.includes(step.id)

      if (completato) blocco.classList.add('completato')

      blocco.innerHTML =
        '<div class="step-numero">' + step.ordine + '</div>' +
        '<div class="step-contenuto ' + classeCriticita + '">' +
        '<span class="badge-criticita ' + (step['criticità'] ? step['criticità'].toLowerCase() : '') + '">' + (step['criticità'] || '') + '</span>' +
        '<p class="step-testo">' + step.testo + '</p>' +
        (step.note ? '<p class="step-note">' + step.note + '</p>' : '') +
        (step.immagine_rif_url ? '<img class="step-foto" src="https://ggnjiemcqcwlzgtojnyy.supabase.co/storage/v1/object/public/guide-photos/' + step.immagine_rif_url + '">' : '') +
        '<button class="btn-completato ' + (completato ? 'fatto' : '') + '" data-id="' + step.id + '" ' + (completato ? 'disabled' : '') + '>' + (completato ? '✓ Fatto' : '✓ Completato') + '</button>' +
        '<button class="btn-segnala" data-id="' + step.id + '" data-testo="' + step.testo + '">⚠ Segnala problema</button>' +
        '<button class="btn-suggerisci" data-id="' + step.id + '" data-guida="' + guida.id + '" data-testo="' + step.testo + '">✏️ Suggerisci modifica</button>' +
        '</div>'
      lista.appendChild(blocco)
    })

    // Attacca listener solo ai bottoni non ancora completati
    document.querySelectorAll('.btn-completato:not([disabled])').forEach(function(btn) {
      btn.addEventListener('click', function() { completaStep(this.dataset.id) })
    })
    document.querySelectorAll('.btn-segnala').forEach(function(btn) {
      btn.addEventListener('click', function() {
        apriModaleErrore(this.dataset.id, this.dataset.testo)
      })
    })
    document.querySelectorAll('.btn-suggerisci').forEach(function(btn) {
      btn.addEventListener('click', function() {
        apriModaleSuggerimento(this.dataset.id, this.dataset.guida, this.dataset.testo)
      })
    })

    mostraSchermata('schermata-step')
  }

  // ── SESSIONE DI ESECUZIONE ────────────────────────────────────────

  // Crea una nuova riga in executions all'apertura di una guida.
  // Lo user_id è l'operaio corrente (non hardcodato).
  // NOTA: il vincolo foreign key executions_user_id_fkey è stato rimosso
  // durante lo sviluppo — da ripristinare in produzione con autenticazione reale.
  async function avviaSessione(guidaId) {
    const { data, error } = await db
      .from('executions')
      .insert({
        guide_id: guidaId,
        user_id: operaioCorrente ? operaioCorrente.id : null,
        stato: 'in corso',
        data_inizio: new Date().toISOString()
      })
      .select()

    if (error) {
      console.error('Errore avvio sessione:', error.message)
      return
    }
    esecuzioneId = data[0].id
  }

  // Registra il completamento di uno step in executions_checklist.
  // Aggiorna visivamente il blocco step: colore verde, testo "✓ Fatto", disabilitato.
  async function completaStep(stepId) {
    if (!esecuzioneId) return

    const { error } = await db
      .from('executions_checklist')
      .insert({
        execution_id: esecuzioneId,
        step_id: stepId,
        completato: true,
        timestamp: new Date().toISOString()
      })

    if (error) {
      console.error('errore completamento step:', error.message)
      return
    }

    const blocco = document.getElementById('step-' + stepId)
    blocco.classList.add('completato')
    const btn = blocco.querySelector('.btn-completato')
    btn.textContent = '✓ Fatto'
    btn.classList.add('fatto')
    btn.disabled = true
  }

  // Chiude la sessione corrente: imposta stato=completata e data_fine.
  // Torna alla home operaio. Azzera esecuzioneId.
  async function chiudiSessione() {
    if (!esecuzioneId) return

    const { error } = await db
      .from('executions')
      .update({
        stato: 'completata',
        data_fine: new Date().toISOString()
      })
      .eq('id', esecuzioneId)

    if (error) {
      console.error('Errore chiusura sessione:', error.message)
      return
    }

    esecuzioneId = null
    guidaCorrente = null
    statoSlot[slotAttivo].guida = null
    statoSlot[slotAttivo].esecuzioneId = null
    mostraSchermata('schermata-home')
  }

  // ── MODALE SEGNALAZIONE ERRORE ────────────────────────────────────

  // stepCorrente: ID dello step su cui viene segnalato l'errore
  let stepCorrente = null

  // Apre il modale di segnalazione errore per uno step specifico.
  function apriModaleErrore(stepId, testoStep) {
    stepCorrente = stepId
    document.getElementById('modale-step-info').textContent = 'Step: ' + testoStep
    document.getElementById('errore-descrizione').value = ''
    document.getElementById('modale-errore').style.display = 'block'
  }

  function chiudiModaleErrore() {
    document.getElementById('modale-errore').style.display = 'none'
    stepCorrente = null
  }

  // ── MODALE SUGGERIMENTO MODIFICA ──────────────────────────────────

  let stepSuggerimento = null
  let guidaSuggerimento = null

  // Apre il modale per suggerire una modifica a uno step specifico.
  function apriModaleSuggerimento(stepId, guidaId, testoStep) {
    stepSuggerimento = stepId
    guidaSuggerimento = guidaId
    document.getElementById('sug-step-info').textContent = 'Step: ' + testoStep
    document.getElementById('sug-tipo').value = ''
    document.getElementById('sug-descrizione').value = ''
    document.getElementById('sug-urgenza').value = 'Quando puoi'
    document.getElementById('modale-suggerimento').style.display = 'block'
  }

  function chiudiModaleSuggerimento() {
    document.getElementById('modale-suggerimento').style.display = 'none'
    stepSuggerimento = null
    guidaSuggerimento = null
  }

  // Salva il suggerimento in Supabase con stato=aperto.
  // L'operaio_id è l'utente corrente (non hardcodato).
  // Il suggerimento appare nella vista supervisore finché non viene archiviato.
  async function inviaSuggerimento() {
    const tipo = document.getElementById('sug-tipo').value
    const descrizione = document.getElementById('sug-descrizione').value.trim()
    const urgenza = document.getElementById('sug-urgenza').value

    if (!tipo) {
      mostraNotifica('Scegli il tipo di modifica.')
      return
    }
    if (!descrizione) {
      mostraNotifica('Aggiungi una descrizione.')
      return
    }

    const { error } = await db
      .from('suggerimenti')
      .insert({
        operaio_id: operaioCorrente ? operaioCorrente.id : null,
        guide_id: guidaSuggerimento,
        step_id: stepSuggerimento,
        tipo: tipo,
        descrizione: descrizione,
        urgenza: urgenza,
        stato: 'aperto'
      })

    if (error) {
      console.error('Errore invio suggerimento:', error.message)
      mostraNotifica('Errore durante l\'invio. Riprova.')
      return
    }

    chiudiModaleSuggerimento()
    mostraNotifica('Suggerimento inviato al supervisore.')
  }

  document.getElementById('btn-invia-suggerimento').addEventListener('click', inviaSuggerimento)
  document.getElementById('btn-annulla-suggerimento').addEventListener('click', chiudiModaleSuggerimento)
  document.getElementById('sfondo-modale-sug').addEventListener('click', chiudiModaleSuggerimento)

  // ── NOTIFICA INLINE ───────────────────────────────────────────────

  // Mostra una notifica toast in basso allo schermo per 3 secondi.
  // Sostituisce alert() — funziona correttamente anche su mobile.
  // La visibilità è gestita con opacity (classe CSS 'visibile') per l'animazione.
  function mostraNotifica(testo) {
    const notifica = document.getElementById('notifica')
    document.getElementById('notifica-testo').textContent = testo
    notifica.style.display = 'block'
    setTimeout(function() { notifica.classList.add('visibile') }, 20)
    setTimeout(function() {
      notifica.classList.remove('visibile')
      setTimeout(function() { notifica.style.display = 'none' }, 300)
    }, 3000)
  }

  // ── SEGNALAZIONE ERRORE — INVIO ───────────────────────────────────

  // Salva la segnalazione errore in error_log.
  // IMPORTANTE: include guide_id (dalla guida corrente) per permettere
  // il filtraggio per azienda nella vista supervisore.
  // Senza guide_id gli errori non appaiono nella vista supervisore.
  async function inviaErrore() {
    const descrizione = document.getElementById('errore-descrizione').value.trim()
    if (!descrizione) return

    const { error } = await db
      .from('error_log')
      .insert({
        step_id: stepCorrente,
        guide_id: guidaCorrente ? guidaCorrente.id : null,
        tipo_errore: 'generico',
        descrizione: descrizione,
        stato: 'aperto'
      })

    if (error) {
      console.error('Errore segnalazione:', error.message)
      return
    }

    chiudiModaleErrore()
    mostraNotifica('Segnalazione inviata. Il supervisore è stato avvisato.')
  }

  // ── LISTENER FINALI ───────────────────────────────────────────────

  document.getElementById('btn-invia-errore').addEventListener('click', inviaErrore)
  document.getElementById('btn-annulla-errore').addEventListener('click', chiudiModaleErrore)
  document.getElementById('sfondo-modale').addEventListener('click', chiudiModaleErrore)
  document.getElementById('btn-chiudi-sessione').addEventListener('click', chiudiSessione)
  document.getElementById('btn-torna').addEventListener('click', function() {
    mostraSchermata('schermata-lista')
  })
  document.getElementById('cerca').addEventListener('input', filtraGuide)
  document.getElementById('btn-torna-home-proponi').addEventListener('click', function() {
    mostraSchermata('schermata-home')
  })
  document.getElementById('btn-aggiungi-step').addEventListener('click', aggiungiStepForm)
  document.getElementById('btn-salva-guida').addEventListener('click', salvaGuida)

}) // fine DOMContentLoaded
