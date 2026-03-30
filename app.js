const SUPABASE_URL = 'https://ggnjiemcqcwlzgtojnyy.supabase.co'
const SUPABASE_KEY = 'sb_publishable_P_UsmvxgGRUxck_iCjEqiA_uloi5PY1'


const { createClient } = supabase 
const db = createClient(SUPABASE_URL, SUPABASE_KEY)
document.addEventListener('DOMContentLoaded', function() {
  let tutteLeGuide = []

async function caricaGuide() {
    const { data, error } = await db
    .from('guide')
    .select('id, titolo, categoria, company_id')
    .eq('approvata', true)

if (error) {
    console.error('Errore caricamento guide:', error.message)
    return
}

 tutteLeGuide = data
 mostraGuide(data)
    
}

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

let categoriaAttiva = 'tutte'

let guidheRecenti = []

function impostaData() {
  const giorni = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
  const mesi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
  const ora = new Date()
  const testo = giorni[ora.getDay()] + ' ' + ora.getDate() + ' ' + mesi[ora.getMonth()] + ' ' + ora.getFullYear()
  document.getElementById('home-data').textContent = testo
}

function aggiungiRecente(guida) {
  guidheRecenti = guidheRecenti.filter(function(g) { return g.id !== guida.id })
  guidheRecenti.unshift(guida)
  if (guidheRecenti.length > 3) guidheRecenti = guidheRecenti.slice(0, 3)
  mostraRecenti()
}

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

let stepFormCount = 0

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

  const { data: guidaData, error: guidaError } = await db
    .from('guide')
    .insert({
      titolo: titolo,
      categoria: categoria,
      descrizione: descrizione,
      created_by: 'Davide',
      approvata: false,
      company_id: tutteLeGuide[0] ? tutteLeGuide[0].company_id : null
    })
    .select()

  if (guidaError) {
    console.error('Errore salvataggio guida:', guidaError.message)
    mostraNotifica('Errore nel salvataggio. Riprova.')
    return
  }

  const guidaId = guidaData[0].id

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

  document.getElementById('input-titolo').value = ''
  document.getElementById('input-categoria').value = ''
  document.getElementById('input-descrizione').value = ''
  document.getElementById('lista-step-form').innerHTML = ''
  stepFormCount = 0

  mostraNotifica('Guida inviata per approvazione.')
  mostraSchermata('schermata-home')
}

async function caricaVistaSupervisore() {
  await caricaErroriAperti()
  await caricaBozze()
  await caricaAttivitaRecente()
  await caricaSuggerimenti()
}

async function caricaErroriAperti() {
  const { data, error } = await db
    .from('error_log')
    .select('id, tipo_errore, descrizione, created_at, step_id')
    .eq('stato', 'aperto')
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

async function chiudiErrore(id) {
  const nota = prompt('Aggiungi una nota di chiusura (opzionale):')
  if (nota === null) return

  const { error } = await db
    .from('error_log')
    .update({
      stato: 'risolto',
      note_chiusura: nota || '',
      chiuso_da: 'supervisore',
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

async function caricaBozze() {
  const { data, error } = await db
    .from('guide')
    .select('id, titolo, categoria')
    .eq('approvata', false)
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
    btn.addEventListener('click', function() {
      approvaGuida(this.dataset.id)
    })
  })

  document.querySelectorAll('.btn-anteprima-bozza').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const id = this.dataset.id
    const titolo = this.dataset.titolo
    apriAnteprimaBozza(id, titolo)
  })
})

document.querySelectorAll('.btn-elimina-guida').forEach(function(btn) {
  btn.addEventListener('click', function() {
    eliminaGuida(this.dataset.id)
  })
})

}

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

async function caricaAttivitaRecente() {
  const { data, error } = await db
    .from('executions')
    .select('id, stato, data_inizio, data_fine, guide_id, user_id, guide:guide_id(titolo), operaio:user_id(nome)')
    .in('stato', ['completata', 'in corso'])
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
    document.querySelectorAll('.card-attivita-mini').forEach(function(card) {
  card.addEventListener('click', function() {
    const guidaId = this.dataset.guideId
    const titolo = this.dataset.titolo
    if (guidaId) apriAnteprimaBozza(guidaId, titolo)
  })
})
}

async function caricaSuggerimenti() {
  const { data, error } = await db
    .from('suggerimenti')
    .select('id, tipo, descrizione, urgenza, stato, created_at, guide_id, step_id, operaio:operaio_id(nome), guida:guide_id(titolo)')
    .eq('stato', 'aperto')
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
    btn.addEventListener('click', function() {
      archiviaSuggerimento(this.dataset.id)
    })
  })
}

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

function filtraGuide() {
  const testo = document.getElementById('cerca').value.toLowerCase()
  const filtrate = tutteLeGuide.filter(function(g) {
    const corrispondeCategoria = categoriaAttiva === 'tutte' || g.categoria === categoriaAttiva
    const corrispondeTesto = g.titolo.toLowerCase().includes(testo)
    return corrispondeCategoria && corrispondeTesto
  })
  mostraGuide(filtrate)
}

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

let esecuzioneId = null

function mostraSchermata(id) {
  document.getElementById('schermata-home').style.display = 'none'
  document.getElementById('schermata-lista').style.display = 'none'
  document.getElementById('schermata-step').style.display = 'none'
  document.getElementById('schermata-supervisore').style.display = 'none'
  document.getElementById('schermata-proponi').style.display = 'none'

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

async function apriGuida(guida) {
    document.getElementById('titolo-guida').textContent = guida.titolo

    aggiungiRecente(guida)
    const { data, error } = await db
    .from('steps')
    .select('id, ordine, testo, note, criticità, immagine_rif_url')
    .eq('guide_id', guida.id)
    .order('ordine', { ascending:true })

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

async function avviaSessione(guidaId) {
    const { data, error } = await db
    .from('executions')
    .insert({
        guide_id: guidaId,
        user_id: '099248c4-0d3b-4d53-97be-918bf9429eed',
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
    mostraSchermata('schermata-home')
}

let stepCorrente = null

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

let stepSuggerimento = null
let guidaSuggerimento = null

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
      operaio_id: '099248c4-0d3b-4d53-97be-918bf9429eed',
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

function mostraNotifica(testo) {
  const notifica = document.getElementById('notifica')
  document.getElementById('notifica-testo').textContent = testo
  notifica.style.display = 'block'
  setTimeout(function() { notifica.classList.add('visibile') }, 20)
  setTimeout(function() {
    notifica.classList.remove('visibile')
    setTimeout (function() { notifica.style.display = 'none'}, 300)
  }, 3000)
}

async function inviaErrore() {
  const descrizione = document.getElementById('errore-descrizione').value.trim()
  if (!descrizione) return

  const { error } = await db
  .from('error_log')
  .insert({
    step_id: stepCorrente,
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

document.getElementById('btn-invia-errore').addEventListener('click', inviaErrore)
document.getElementById('btn-annulla-errore').addEventListener('click', chiudiModaleErrore)
document.getElementById('sfondo-modale').addEventListener('click', chiudiModaleErrore)

document.getElementById('btn-chiudi-sessione').addEventListener('click', chiudiSessione)

document.getElementById('btn-torna'). addEventListener('click', function() {
    mostraSchermata('schermata-lista')
})

document.getElementById('cerca').addEventListener('input', filtraGuide)

document.getElementById('btn-torna-home-proponi').addEventListener('click', function() {
  mostraSchermata('schermata-home')
})

document.getElementById('btn-aggiungi-step').addEventListener('click', aggiungiStepForm)

document.getElementById('btn-salva-guida').addEventListener('click', salvaGuida)

impostaData()
caricaGuide()  

})
