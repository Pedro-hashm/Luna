import {
  isPublicIpAddress,
  UnsafeWebUrlError,
  validateWebUrl,
} from './web-url-safety';

describe('web URL safety', () => {
  it.each([
    'http://localhost/',
    'http://127.0.0.1/',
    'http://0177.0.0.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://10.1.2.3/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://server.internal/',
    'http://example.com:8080/',
    'file:///etc/passwd',
    'https://user:password@example.com/',
  ])('rejects unsafe destination %s', (url) => {
    expect(() => validateWebUrl(url)).toThrow(UnsafeWebUrlError);
  });

  it('rejects non-public DNS answers and reserved ranges', () => {
    expect(isPublicIpAddress('1.1.1.1')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicIpAddress('100.64.1.1')).toBe(false);
    expect(isPublicIpAddress('198.18.0.1')).toBe(false);
    expect(isPublicIpAddress('2001:db8::1')).toBe(false);
    expect(isPublicIpAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('applies domain restrictions to subdomains only', () => {
    expect(
      validateWebUrl('https://news.example.com/', ['example.com']).hostname,
    ).toBe('news.example.com');
    expect(() =>
      validateWebUrl('https://example.com.evil.org/', ['example.com']),
    ).toThrow(UnsafeWebUrlError);
  });
});
