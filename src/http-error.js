export class HttpError extends Error {
  constructor(message, { status, data, url, method } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.data = data;
    this.url = url;
    this.method = method;
  }
}
