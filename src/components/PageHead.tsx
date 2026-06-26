import { Helmet } from "react-helmet-async";

const SITE = "https://gever-mountain-chat.lovable.app";

type Props = {
  title: string;
  description?: string;
  path: string;
};

export default function PageHead({ title, description, path }: Props) {
  const url = `${SITE}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:url" content={url} />
      {description && <meta property="og:description" content={description} />}
      <meta name="twitter:title" content={title} />
      {description && <meta name="twitter:description" content={description} />}
    </Helmet>
  );
}
