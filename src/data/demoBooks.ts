// DATI DIMOSTRATIVI — libri fittizi/generici. Notazioni Dewey e campi MARC
// sono esempi illustrativi NON validati.
import type { Book } from "@/lib/api/types";

export const demoBooks: Book[] = [
  { id: "1", title: "Il giardino delle stagioni", author: "Rossi, Maria", isbn: "9788800000011", publisher: "Edizioni Aurora", year: 2018, subjects: ["Giardinaggio", "Botanica"], dewey: "635", location: "SALA A 635 ROS", status: "catalogato" },
  { id: "2", title: "Breve storia del Mediterraneo", author: "Bianchi, Luca", isbn: "9788800000028", publisher: "Casa Editrice Orizzonte", year: 2015, subjects: ["Mediterraneo – Storia"], dewey: "909", location: "SALA B 909 BIA", status: "catalogato" },
  { id: "3", title: "Introduzione alla chimica organica", author: "Esposito, Anna", isbn: "9788800000035", publisher: "Scienza Aperta", year: 2020, subjects: ["Chimica organica"], dewey: "547", location: "SALA C 547 ESP", status: "da revisionare" },
  { id: "4", title: "Le città invisibili del Nord", author: "Romano, Paolo", isbn: "9788800000042", publisher: "Edizioni Aurora", year: 2011, subjects: ["Narrativa italiana"], dewey: "853", location: "NARR ROM", status: "catalogato" },
  { id: "5", title: "Manuale di fotografia digitale", author: "Colombo, Giulia", isbn: "9788800000059", publisher: "Tecnica & Arte", year: 2019, subjects: ["Fotografia digitale"], dewey: "775", location: "SALA A 775 COL", status: "bozza" },
  { id: "6", title: "Pensare con chiarezza", author: "Ricci, Marco", isbn: "9788800000066", publisher: "Filosofia Oggi", year: 2017, subjects: ["Logica", "Pensiero critico"], dewey: "160", location: "SALA B 160 RIC", status: "catalogato" },
  { id: "7", title: "Cucina regionale italiana", author: "Marino, Elena", isbn: "9788800000073", publisher: "Sapori Editore", year: 2014, subjects: ["Cucina italiana"], dewey: "641.5945", location: "SALA A 641 MAR", status: "catalogato" },
  { id: "8", title: "Astronomia per tutti", author: "Greco, Stefano", isbn: "9788800000080", publisher: "Scienza Aperta", year: 2021, subjects: ["Astronomia – Divulgazione"], dewey: "520", location: "SALA C 520 GRE", status: "da revisionare" },
  { id: "9", title: "Poesie del mattino", author: "Bruno, Chiara", isbn: "9788800000097", publisher: "Edizioni Aurora", year: 2009, subjects: ["Poesia italiana"], dewey: "851", location: "POES BRU", status: "bozza" },
];
