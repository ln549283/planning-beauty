const form = document.querySelector('#appointment');
const list = document.querySelector('#appointments');
const empty = document.querySelector('#empty');
const error = document.querySelector('#error');
const storageKey = 'planning-beauty.appointments';
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

let appointments = [];
try {
  appointments = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
} catch {
  error.textContent = 'Impossible de charger les rendez-vous enregistrés.';
  error.hidden = false;
}

function save(nextAppointments) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(nextAppointments));
  } catch {
    error.textContent = 'Impossible d’enregistrer le planning dans ce navigateur.';
    error.hidden = false;
    return false;
  }

  appointments = nextAppointments;
  error.hidden = true;
  render();
  return true;
}

function render() {
  list.replaceChildren();
  empty.hidden = appointments.length > 0;

  for (const appointment of appointments) {
    const item = document.createElement('li');
    const details = document.createElement('span');
    details.textContent = `${appointment.service} · ${dateFormat.format(new Date(appointment.date))}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Supprimer';
    remove.setAttribute('aria-label', `Supprimer ${details.textContent}`);
    remove.addEventListener('click', () => {
      save(appointments.filter((entry) => entry !== appointment));
    });
    item.append(details, remove);
    list.append(item);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const service = form.elements.service.value.trim();
  const date = form.elements.date.value;
  if (!service || !date) return;

  const nextAppointments = [...appointments, { service, date }];
  nextAppointments.sort((first, second) => first.date.localeCompare(second.date));
  if (save(nextAppointments)) form.reset();
});

render();
