import { handleJevProxy, type ProxyEnv } from "../../../src/proxy/handler";

export const onRequest: PagesFunction<ProxyEnv> = (context) => {
  const segments = context.params.path;
  const path = Array.isArray(segments) ? segments.join("/") : (segments ?? "");
  return handleJevProxy(context.request, path, context.env);
};
