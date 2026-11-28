import { buttonClass, fieldClass, noticeClass } from "@/modules/ui";
import { PHOTO_REMOVE_PATH, PHOTO_UPLOAD_PATH, photoUrl, type PhotoStatus } from "../domain/photo";

// Foto do perfil na tela de /perfil (#308). Só apresentação: quem converte, cifra e grava são as rotas
// do servidor. Fora do formulário principal (envio de arquivo é outro POST). Só aparece com a chave
// `profile.photoEnabled` ligada (desligada por padrão até o termo v2, #311).

export type PhotoText = {
  photoTitle: string;
  /** As regras do envio: foto da própria pessoa, real, estilo 3x4, sem anime e sem imagem de IA. */
  photoRules: string;
  /** O aviso do uso: quem vê a foto e que dá para trocar ou remover. */
  photoNotice: string;
  photoChoose: string;
  photoSend: string;
  photoReplaceHint: string;
  photoRemove: string;
  photoAlt: string;
  photoStatus: Record<PhotoStatus, string>;
};

type Props = {
  enabled: boolean;
  profileId: string;
  hasPhoto: boolean;
  status: PhotoStatus | null;
  text: PhotoText;
};

export function PhotoSection({ enabled, profileId, hasPhoto, status, text }: Props) {
  if (!enabled) return null;
  return (
    <section aria-labelledby="perfil-foto" className="flex flex-col gap-4">
      <h2 id="perfil-foto" className="text-2xl font-semibold">
        {text.photoTitle}
      </h2>
      {status && (
        <p role="status" className={noticeClass(status === "ok" || status === "removida" ? "success" : "error")}>
          {text.photoStatus[status]}
        </p>
      )}
      <p className="text-lg">{text.photoRules}</p>
      <p className="text-base">{text.photoNotice}</p>
      {hasPhoto && (
        // Rota protegida por sessão: o otimizador do Next não teria o cookie, então <img> comum.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl(profileId)} alt={text.photoAlt} width={96} height={128} className="h-32 w-24 rounded-control border border-line object-cover" />
      )}
      <form method="post" action={PHOTO_UPLOAD_PATH} encType="multipart/form-data" className="flex flex-col gap-3">
        <label htmlFor="perfil-foto-arquivo" className="text-xl font-semibold">
          {text.photoChoose}
        </label>
        {hasPhoto && <p className="text-base">{text.photoReplaceHint}</p>}
        <input id="perfil-foto-arquivo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className={fieldClass()} />
        <button type="submit" className={buttonClass("primary", "lg")}>
          {text.photoSend}
        </button>
      </form>
      {hasPhoto && (
        <form method="post" action={PHOTO_REMOVE_PATH}>
          <button type="submit" className={buttonClass("secondary", "lg")}>
            {text.photoRemove}
          </button>
        </form>
      )}
    </section>
  );
}
