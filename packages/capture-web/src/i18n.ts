/**
 * Framework-chrome strings ONLY (buttons, status, generic errors). Domain
 * text — step titles, guidance, finding statements — comes from protocol
 * data and is the protocol author's to localize; it must never live here.
 */
export interface CaptureStrings {
  takePhoto: string;
  retake: string;
  accept: string;
  skip: string;
  next: string;
  submit: string;
  uploading: string;
  waitingForAnalysis: string;
  analystRequestedMore: string;
  completed: string;
  photoLooksBlurry: string;
  resolutionTooLow: string;
  optionalStep: string;
  /** Boolean questions render as an explicit pair — never a lone checkbox, which
   *  cannot tell "no" apart from "not answered yet". */
  yes: string;
  no: string;
  stepProgress: (current: number, total: number) => string;
  uploadFailedRetrying: string;
  uploadFailedPermanently: string;
}

export const en: CaptureStrings = {
  takePhoto: 'Take photo',
  retake: 'Retake',
  accept: 'Use this photo',
  skip: 'Skip',
  next: 'Next',
  submit: 'Submit for analysis',
  uploading: 'Uploading…',
  waitingForAnalysis: 'Submitted — waiting for analysis…',
  analystRequestedMore: 'The analyst asked for more evidence:',
  completed: 'Assessment complete',
  photoLooksBlurry: 'This photo looks blurry. Hold steady and try again — sharp photos produce better results.',
  resolutionTooLow: 'The photo resolution is too low for analysis.',
  optionalStep: 'Optional',
  yes: 'Yes',
  no: 'No',
  stepProgress: (current, total) => `Step ${current} of ${total}`,
  uploadFailedRetrying: 'Upload failed — retrying…',
  uploadFailedPermanently: 'Upload failed permanently. This capture was not saved.',
};

export const ptBR: CaptureStrings = {
  takePhoto: 'Tirar foto',
  retake: 'Tirar outra',
  accept: 'Usar esta foto',
  skip: 'Pular',
  next: 'Avançar',
  submit: 'Enviar para análise',
  uploading: 'Enviando…',
  waitingForAnalysis: 'Enviado — aguardando análise…',
  analystRequestedMore: 'O analista pediu mais evidências:',
  completed: 'Avaliação concluída',
  photoLooksBlurry: 'A foto parece tremida. Segure firme e tente de novo — fotos nítidas geram resultados melhores.',
  resolutionTooLow: 'A resolução da foto é baixa demais para análise.',
  optionalStep: 'Opcional',
  yes: 'Sim',
  no: 'Não',
  stepProgress: (current, total) => `Passo ${current} de ${total}`,
  uploadFailedRetrying: 'Falha no envio — tentando novamente…',
  uploadFailedPermanently: 'Falha permanente no envio. Esta captura não foi salva.',
};
