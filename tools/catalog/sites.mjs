// Τα sites που εγκρίθηκαν (data/sites.md) και ποια επαγγέλματα καλύπτει το καθένα.
// trades: κλειδιά του TRADES. Η συλλογή κρατά μόνο κατηγορίες που ταιριάζουν σε αυτά τα επαγγέλματα.
export const TRADES = {
  plumber:     {name: 'υδραυλικός',           re: /υδραυλ|μπάνι|υγιειν|μπαταρ|λεκάν|νιπτήρ|καζανάκ|ντουζ|μπανιέρ|νεροχύτ|σιφών|σωλήν|ύδρευσ|αποχέτευσ|θερμοσίφων|boiler|μπόιλερ|βάν[αε]ς?|διακόπτ(ες|ης) νερού|ρακόρ|εξαρτήματα σωλ|φρεάτι|σχάρ/i},
  heating:     {name: 'θερμοϋδραυλικός',      re: /θέρμανσ|καλοριφέρ|σώματα|θερμαντικ|λέβητ|καυστήρ|κυκλοφορητ|ενδοδαπέδ|αντλίες? θερμότητ|δοχεία? διαστολ|συλλέκτ|φυσικ(ό|ού) αερί|ηλιακ/i},
  electrician: {name: 'ηλεκτρολόγος',         re: /ηλεκτρολογ|καλώδι|πρίζ|διακόπτ(ες|ης)(?! νερού)|ασφάλει|πίνακ(ες|α) ηλεκ|ερμάρι|ραγο|ρελέ|φωτισμ|φωτιστικ|λάμπ|λαμπτήρ|led|σποτ|κανάλι|σωλήνες? ηλεκ|κουδούν|θυροτηλ/i},
  tiler:       {name: 'πλακάς',               re: /πλακάκ|πλακίδ|πορσελανάτ|κεραμικ|ψηφίδ|κόλλες? πλακ|αρμόστοκ|αρμοί|σοβατεπί|προφίλ πλακ/i},
  painter:     {name: 'ελαιοχρωματιστής',     re: /χρώμα|χρώματ|βερνίκ|αστάρ|στόκο|στόκοι|πλαστικ(ά|ό) χρ|ακρυλικ|ριπολίν|διαλυτικ|πινέλ|ρολ(ά|ό) βαφ|βαφή/i},
  drywall:     {name: 'γυψοσανιδάς',          re: /γυψοσανίδ|τσιμεντοσανίδ|ξηρά δόμηση|ξηράς δόμησης|ψευδοροφ|προφίλ γυψ|ορθοστάτ|οδηγ(οί|ός) γυψ|στόκοι? αρμ|ταινί(α|ες) αρμ/i},
  hvac:        {name: 'ψυκτικός',             re: /κλιματισ|κλιματιστικ|ψύξη|ψυκτικ|χαλκοσωλ|inverter|split|αφυγραντ|βάσεις? κλιμα|ψυκτικ(ό|ά) υγρ/i},
  insulation:  {name: 'μονωτής',              re: /μόνωσ|μονωτικ|στεγαν|θερμοπρόσοψ|πολυστερίν|εξηλασμέν|πετροβάμβακ|υαλοβάμβακ|μεμβράν|ασφαλτικ|ελαστομερ|υαλόπλεγμα|xps|eps/i},
  flooring:    {name: 'δαπεδοστρώτης',        re: /δάπεδ|πάτωμ|laminate|spc|lvt|βινυλικ|παρκέ|υπόστρωμ|σοβατεπί/i},
  plasterer:   {name: 'σοβατζής',             re: /δομικ|κατασκευαστικ(ά|ό) υλικ|σοβά|κονίαμ|τσιμέντ|ασβέστ|άμμος|τούβλ|πορομπετ|ytong|τσιμεντόλιθ|γωνιόκραν|σοβατόπηχ|πλέγμα σοβ|επισκευαστικ|αυτοεπιπεδ/i},
  carpenter:   {name: 'ξυλουργός',            re: /ξυλεία|ξύλιν(α|ες|ο) (προϊ|σανίδ|πάνελ)|πόρτ(α|ες) εσωτ|εσωτερικ(ές|ή) πόρτ|ντουλάπ|κουζίν(α|ες)(?! εστ)|έπιπλ(α|ο) κουζ|μεντεσ|συρόμεν|μηχανισμ(οί|ός) επιπλ|χερούλ|κλειδαρι|πόμολ|μελαμίν|μοριοσανίδ|mdf|κόντρα πλακέ/i},
  marble:      {name: 'μαρμαράς',             re: /μάρμαρ|μαρμαρ|γρανίτ|χαλαζί|πάγκ(ος|οι)|ποδι(ά|ές)|σκαλοπάτ|κατωκάσ|solid surface/i},
};

export const SITES = [
  // Praktiker: ομάδες κατηγοριών /cg/, κατηγορίες /c/, προϊόντα /p/ (κάρτες χωρίς σταθερές κλάσεις).
  {id: 'praktiker',      url: 'https://www.praktiker.gr',            trades: ['plumber','heating','electrician','tiler','painter','drywall','hvac','insulation','flooring','plasterer','carpenter'],
    productUrl: /\/p\//, categoryUrl: /\/(c|cg)\//, maxDepth: 3,
    // Οι ομάδες κατηγοριών από το δημόσιο sitemap (media/sitemap/Auto/SitemapCollection.xml)· η αρχική δείχνει μόνο μερικές.
    seeds: ['klima-kai-energeia','mpanio-kouzina','plakakia-patomata','domika-ylika-monosi','xromata-vernikia','portes-parathyra-8',
      'ilektrologika-fotismos','ydraulika-egkatastaseis','ergaleia-eidi-kigkalerias'].map(g => `https://www.praktiker.gr/cg/${g}`)},
  {id: 'toolcase',       url: 'https://www.toolcase.gr',             trades: ['plumber','heating','electrician','painter','hvac']},
  {id: 'youbath',        url: 'https://youbath.gr',                  trades: ['plumber','heating','tiler']},
  {id: 'mafou',          url: 'https://mafou.gr',                    trades: ['plumber','heating']},
  {id: 'fabricashop',    url: 'https://www.fabricashop.gr',          trades: ['plumber','tiler'], productUrl: /\/product\//},
  {id: 'karag',          url: 'https://karag.gr',                    trades: ['plumber','tiler']},
  {id: 'peltekis',       url: 'https://peltekis-tools.gr',           trades: ['plumber','painter']},
  {id: 'thermogroup',    url: 'https://thermogroup.gr',              trades: ['heating','hvac']},
  {id: 'tehnothermiki',  url: 'https://tehnothermiki.gr',            trades: ['heating','hvac']},
  {id: 'meidanis',       url: 'https://www.meidanis.gr',             trades: ['electrician']},
  {id: 'el-shop',        url: 'https://el-shop.gr',                  trades: ['electrician']},
  {id: 'paravalos',      url: 'https://paravalos.gr',                trades: ['tiler','drywall','plasterer']},
  {id: 'kaxiris',        url: 'https://kaxirismonotika.gr',          trades: ['tiler','insulation','plasterer']},
  {id: 'vrontinos',      url: 'https://vrontinos.gr',                trades: ['tiler','painter','drywall','insulation','plasterer'], productUrl: /\/el\/Product\//, categoryUrl: /\/ProductCategory\//},
  {id: 'papasideris',    url: 'https://e-papasideris.gr',            trades: ['painter','drywall','plasterer']},
  {id: 'kouremenos',     url: 'https://kouremenos.net',              trades: ['painter','drywall','plasterer']},
  {id: 'vogiatzakis',    url: 'https://www.vogiatzakis.gr',          trades: ['painter']},
  {id: 'xromatopolio',   url: 'https://www.xromatopolio.gr',         trades: ['painter']},
  {id: 'paintcity',      url: 'https://paintcity.gr',                trades: ['tiler','painter','plasterer']},
  {id: 'easy-parts',     url: 'https://easy-parts.gr',               trades: ['hvac']},
  {id: 'climaver',       url: 'https://climaver.gr',                 trades: ['hvac']},
  {id: 'mylonas',        url: 'https://mylonasergaleia.gr',          trades: ['insulation']},
  {id: 'strati',         url: 'https://strati.gr',                   trades: ['flooring']},
  {id: 'dapeda',         url: 'https://dapeda.net',                  trades: ['flooring']},
  {id: 'ikea',           url: 'https://www.ikea.gr',                 trades: ['carpenter'], productUrl: /\/proioda\/[^/]+\/\d{5,}\/?$/, categoryUrl: /\/proioda\//},
  {id: 'epipla1',        url: 'https://www.epipla1.gr',              trades: ['carpenter']},
  {id: 'homeville',      url: 'https://homeville.gr',                trades: ['carpenter']},
  {id: 'e-metallon',     url: 'https://e-metallon.gr',               trades: ['carpenter']},
  {id: 'billis',         url: 'https://www.marmara-billis.gr',       trades: ['marble'], productUrl: /\/product\/\d+\//, categoryUrl: /\/categories\/\d+\//},
  //   {id: 'e-shop',         url: 'https://www.e-shop.gr',               trades: ['electrician','hvac']},  // δεν συλλέγεται: προϊόντα/τιμές με JavaScript
  //   {id: 'kotsovolos',     url: 'https://www.kotsovolos.gr',           trades: ['hvac']},  // δεν συλλέγεται: προϊόντα/τιμές με JavaScript
  {id: 'e-dimakis',      url: 'https://e-dimakis.gr',                trades: ['plumber','heating','hvac']},
  {id: 'ergo-tel',       url: 'https://ergo-tel.gr',                 trades: ['electrician']},
  {id: 'doukas',         url: 'https://www.doukas.com.gr',           trades: ['drywall','insulation']},
  {id: 'ktec',           url: 'https://www.ktec.gr',                 trades: ['drywall','insulation']},
  {id: 'kostelidis',     url: 'https://kostelidis.gr',               trades: ['insulation','plasterer']},
  {id: 'krono-shop',     url: 'https://krono-shop.com/gr/el/',       trades: ['flooring'], productUrl: /\/gr\/el\/[^/]+\/KS\d+-\d+/},   // το robots.txt κλείνει το «?»: μόνο 1η σελίδα ανά κατηγορία
  {id: 'jerotech',       url: 'https://jerotech.eu',                 trades: ['flooring']},
  {id: 'portes-koufomata', url: 'https://www.portes-koufomata.gr',   trades: ['carpenter'], productUrl: /^https:\/\/www\.portes-koufomata\.gr\/[^/?]+\/[^/?]+\/[^/?]+$/},   // προϊόν = 3 επίπεδα path
  {id: 'balamoti',       url: 'https://balamoti.gr',                 trades: ['painter','carpenter']},
];
