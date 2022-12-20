import { RequestCookie } from 'next/dist/server/web/spec-extension/cookies';
import { NextRequest, NextResponse } from 'next/server';

import { AUTH_RESULT, RequestLike } from '../types';

type RequestProps = {
  req: NextRequest;
  authResult: string;
};

export function setPrivateAuthResultOnRequest({ req, authResult }: RequestProps): void {
  Object.assign(req, { _authResult: authResult });
}

// Tries to extract auth result from the request using several strategies
export function getAuthResultFromRequest(req: RequestLike): string | null | undefined {
  console.log(
    'appdir :: getAuthResultFromRequest',
    getPrivateAuthResult(req),
    getHeader(req, AUTH_RESULT),
    getQueryParam(req, AUTH_RESULT),
  );
  return getPrivateAuthResult(req) || getHeader(req, AUTH_RESULT) || getQueryParam(req, AUTH_RESULT);
}

function getPrivateAuthResult(req: RequestLike): string | null | undefined {
  const r = req as never;
  return '_authResult' in r ? r['_authResult'] : undefined;
}

function getQueryParam(req: RequestLike, name: string): string | null | undefined {
  if (isNextRequest(req)) {
    return req.nextUrl.searchParams.get(name);
  }

  // Check if the request contains a parsed query object
  // NextApiRequest does, but the IncomingMessage in the GetServerSidePropsContext case does not
  let queryParam: string | null | undefined;
  if ('query' in req) {
    queryParam = req.query[name] as string | undefined;
  }

  // Fall back to query string
  if (!queryParam) {
    const qs = (req.url || '').split('?')[1];
    queryParam = new URLSearchParams(qs).get(name);
  }
  return queryParam;
}

export function getHeader(req: RequestLike, name: string): string | null | undefined {
  if (isNextRequest(req)) {
    return req.headers.get(name);
  }

  // If no header has been determined for IncomingMessage case, check if available within private `socket` headers
  // When deployed to vercel, req.headers for API routes is a `IncomingHttpHeaders` key-val object which does not follow
  // the Headers spec so the name is no longer case-insensitive.
  return req.headers[name] || req.headers[name.toLowerCase()] || (req.socket as any)?._httpMessage?.getHeader(name);
}

export function getCookie(req: RequestLike, name: string): string | undefined {
  if (isNextRequest(req)) {
    // Nextjs broke semver in the 13.0.0 -> 13.0.1 release, so even though
    // this should be RequestCookie in all updated apps. In order to support apps
    // using v13.0.0 still, we explicitly add the string type
    // https://github.com/vercel/next.js/pull/41526
    const reqCookieOrString = req.cookies.get(name) as RequestCookie | string | undefined;
    if (!reqCookieOrString) {
      return undefined;
    }
    return typeof reqCookieOrString === 'string' ? reqCookieOrString : reqCookieOrString.value;
  }
  return req.cookies[name];
}

function isNextRequest(val: unknown): val is NextRequest {
  try {
    const { headers, nextUrl, cookies } = (val || {}) as NextRequest;
    return (
      typeof headers?.get === 'function' &&
      typeof nextUrl?.searchParams.get === 'function' &&
      typeof cookies?.get === 'function'
    );
  } catch (e) {
    return false;
  }
}

const OVERRIDE_HEADERS = 'x-middleware-override-headers';
const MIDDLEWARE_HEADER_PREFIX = 'x-middleware-request' as string;

export const setRequestHeadersOnNextResponse = (
  res: NextResponse | Response,
  req: NextRequest,
  newHeaders: Record<string, string>,
) => {
  if (!res.headers.get(OVERRIDE_HEADERS)) {
    // Emulate a user setting overrides by explicitly adding the required nextjs headers
    // https://github.com/vercel/next.js/pull/41380
    // @ts-expect-error
    res.headers.set(OVERRIDE_HEADERS, [...req.headers.keys()]);
    req.headers.forEach((val, key) => {
      res.headers.set(`${MIDDLEWARE_HEADER_PREFIX}-${key}`, val);
    });
  }

  // Now that we have normalised res to include overrides, just append the new header
  Object.entries(newHeaders).forEach(([key, val]) => {
    res.headers.set(OVERRIDE_HEADERS, `${res.headers.get(OVERRIDE_HEADERS)},${key}`);
    res.headers.set(`${MIDDLEWARE_HEADER_PREFIX}-${key}`, val);
  });
};

/**
 * Test whether the currently installed nextjs version supports overriding the request headers.
 * This feature was added in nextjs v13.0.1
 * https://github.com/vercel/next.js/pull/41380
 */
export const nextJsVersionCanOverrideRequestHeaders = () => {
  try {
    const headerKey = 'clerkTest';
    const headerKeyInRes = `${MIDDLEWARE_HEADER_PREFIX}-${headerKey}`;
    const res = NextResponse.next({ request: { headers: new Headers({ [headerKey]: 'true' }) } });
    return res.headers.has(headerKeyInRes);
  } catch (e) {
    return false;
  }
};
