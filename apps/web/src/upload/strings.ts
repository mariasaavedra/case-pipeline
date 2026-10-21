// =============================================================================
// Client upload page — every word, in Spanish and English
// =============================================================================
// Plain words for clients who may read neither language well: short sentences,
// no legal terms. The Spanish is to be checked by staff before the trial.
// =============================================================================

export type Lang = "es" | "en";
export type KindKey = "id" | "notice" | "evidence" | "other";

export const FIRM_NAME = "Sharma-Crawford Attorneys at Law";
export const FIRM_PHONE = "(816) 994-2300";
export const FIRM_PHONE_TEL = "+18169942300";

export interface Strings {
  langSwitch: string;
  title: (firstName: string | null) => string;
  intro: string;
  kindQuestion: string;
  kinds: Record<KindKey, string>;
  noteLabel: string;
  notePlaceholder: string;
  takePhoto: string;
  chooseFiles: string;
  allowed: string;
  waiting: string;
  sending: (pct: number) => string;
  received: string;
  duplicate: string;
  retry: string;
  remove: string;
  doneTitle: string;
  doneBody: string;
  errors: {
    tooBig: string;
    type: string;
    linkFull: string;
    tooMany: string;
    dead: string;
    network: string;
    other: string;
  };
  loading: string;
  deadTitle: string;
  deadBody: string;
  questions: string;
  privacy: string;
}

export const STRINGS: Record<Lang, Strings> = {
  es: {
    langSwitch: "English",
    title: (n) => (n ? `Hola, ${n}` : "Hola"),
    intro: "Aquí puede enviarnos sus documentos. Solo nuestra oficina los puede ver.",
    kindQuestion: "¿Qué nos está enviando?",
    kinds: { id: "Identificación o pasaporte", notice: "Carta de USCIS o de la corte", evidence: "Pruebas para su caso", other: "Otro documento" },
    noteLabel: "Mensaje para la oficina (opcional)",
    notePlaceholder: "Por ejemplo: la carta llegó el lunes",
    takePhoto: "Tomar una foto",
    chooseFiles: "Elegir archivos",
    allowed: "Fotos, PDF o Word. Hasta 50 MB cada uno.",
    waiting: "En espera…",
    sending: (p) => `Enviando… ${p}%`,
    received: "Recibido",
    duplicate: "Ya lo teníamos",
    retry: "Intentar otra vez",
    remove: "Quitar",
    doneTitle: "¡Recibimos sus documentos!",
    doneBody: "Ya puede cerrar esta página, o enviar más.",
    errors: {
      tooBig: "Este archivo es muy grande (más de 50 MB).",
      type: "No podemos recibir este tipo de archivo. Envíe una foto, un PDF o un documento de Word.",
      linkFull: "Este enlace ya recibió todos los archivos que puede. Pida uno nuevo a la oficina.",
      tooMany: "Demasiados archivos a la vez. Espere unos minutos y vuelva a intentar.",
      dead: "Este enlace ya no sirve. Pida uno nuevo a la oficina.",
      network: "No se pudo enviar. Revise su conexión e intente otra vez.",
      other: "Algo salió mal. Intente otra vez.",
    },
    loading: "Cargando…",
    deadTitle: "Este enlace ya no sirve",
    deadBody: "Puede que haya vencido. Llame a la oficina y le enviaremos uno nuevo.",
    questions: "¿Preguntas? Llámenos al",
    privacy: "Sus archivos van directo a su expediente. Nadie más puede verlos desde esta página.",
  },
  en: {
    langSwitch: "Español",
    title: (n) => (n ? `Hi, ${n}` : "Hi"),
    intro: "Send us your documents here. Only our office can see them.",
    kindQuestion: "What are you sending?",
    kinds: { id: "ID or passport", notice: "Letter from USCIS or the court", evidence: "Evidence for your case", other: "Other document" },
    noteLabel: "Message for the office (optional)",
    notePlaceholder: "For example: the letter came on Monday",
    takePhoto: "Take a photo",
    chooseFiles: "Choose files",
    allowed: "Photos, PDF or Word. Up to 50 MB each.",
    waiting: "Waiting…",
    sending: (p) => `Sending… ${p}%`,
    received: "Received",
    duplicate: "We already had it",
    retry: "Try again",
    remove: "Remove",
    doneTitle: "We received your documents!",
    doneBody: "You can close this page now, or send more.",
    errors: {
      tooBig: "This file is too big (over 50 MB).",
      type: "We can't take this kind of file. Send a photo, a PDF or a Word document.",
      linkFull: "This link has received all the files it can. Ask the office for a new one.",
      tooMany: "Too many files at once. Wait a few minutes and try again.",
      dead: "This link doesn't work any more. Ask the office for a new one.",
      network: "It didn't send. Check your connection and try again.",
      other: "Something went wrong. Try again.",
    },
    loading: "Loading…",
    deadTitle: "This link doesn't work any more",
    deadBody: "It may have expired. Call the office and we'll send you a new one.",
    questions: "Questions? Call us at",
    privacy: "Your files go straight to your case file. No one else can see them from this page.",
  },
};
