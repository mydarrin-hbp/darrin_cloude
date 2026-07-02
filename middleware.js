import { rewrite } from '@vercel/functions';

export const config = {
  matcher: ['/((?!.*\\.).*)'],
};

export default function middleware(request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') || '';

  if (host === 'api.mydarrin.homebestpal.com') {
    if (!url.pathname.startsWith('/api/')) {
      const target = new URL(request.url);
      target.pathname = '/api' + url.pathname;
      return rewrite(target);
    }
    return;
  }

  if (host === 'admin.mydarrin.homebestpal.com') {
    if (url.pathname === '/') {
      return rewrite(new URL('/mydarrin-superadmin.html', request.url));
    }
    if (url.pathname === '/backoffice') {
      return rewrite(new URL('/mydarrin-backoffice-serviciu.html', request.url));
    }
    return;
  }

  if (url.pathname === '/') {
    return rewrite(new URL('/mydarrin-v3.html', request.url));
  }
  if (url.pathname === '/catalog') {
    return rewrite(new URL('/mydarrin-catalog.html', request.url));
  }
  if (url.pathname === '/devino-partener') {
    return rewrite(new URL('/mydarrin-devino-partener.html', request.url));
  }
}
