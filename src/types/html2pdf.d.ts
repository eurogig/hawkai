declare module "html2pdf.js" {
  export interface Html2PdfOptions {
    filename?: string;
    margin?: number | number[];
    image?: { type?: string; quality?: number };
    html2canvas?: { scale?: number; useCORS?: boolean };
    jsPDF?: { unit?: string; format?: string | string[]; orientation?: string };
  }

  interface Html2PdfInstance {
    set(options: Html2PdfOptions): Html2PdfInstance;
    from(element: HTMLElement | string): Html2PdfInstance;
    save(): Promise<void>;
  }

  export default function html2pdf(): Html2PdfInstance;
}
