/**
 * Receives a HTTP request and replies with a response.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleRequest(request) {
  const { protocol, pathname } = new URL(request.url);

  // Require HTTPS (TLS) connection to be secure.
  if (
    "https:" !== protocol ||
    "https" !== request.headers.get("x-forwarded-proto")
  ) {
    throw new BadRequestException("Please use a HTTPS connection.");
  }

  switch (pathname) {
    case "/":
      return new Response("Hello World!", {
        status: 200,
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          "Cache-Control": "no-store"
        },
      });

    case "/update": {

      // Throws exception when query parameters aren't formatted correctly
      const url = new URL(request.url);
      verifyParameters(url);

      // Only returns this response when no exception is thrown.
      const response = await informAPI(url);
      return response;

    }

    case "/favicon.ico":
    case "/robots.txt":
      return new Response(null, { status: 204 });
  }

  return new Response("Not Found.", { status: 404 });
}

/**
 * Pass the request info to the Cloudflare API Handler
 * @param {URL} url
 * @param {String} name
 * @param {String} token
 * @returns {Promise<Response>}
 */
async function informAPI(url) {
  // Parse Url
  const host = url.searchParams.get("host");
  const domain = url.searchParams.get("domain");
  const token = url.searchParams.get("password");
  const ip = url.searchParams.get("ip");
  const hostname = host + "." + domain;

  // Initialize API Handler
  const cloudflare = new Cloudflare({
    token: token,
  });

  const zone = await cloudflare.findZone(domain);
  const record = await cloudflare.findRecord(zone, hostname);
  const result = await cloudflare.updateRecord(record, ip);

  // Only returns this response when no exception is thrown.
  return new Response("DNS Record Update Successful!", {
    status: 200,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Cache-Control": "no-store"
    },
  });
}

/**
 * Throws exception on verification failure.
 * @param {string} url
 * @throws {UnauthorizedException}
 */
function verifyParameters(url) {
  if (!url.searchParams) {
    throw new BadRequestException("You must include proper query parameters");
  }

  if (!url.searchParams.get("domain")) {
    throw new BadRequestException("You must specify a domain");
  }

  if (!url.searchParams.get("host")) {
    throw new BadRequestException("You must specify a host");
  }

  if (!url.searchParams.get("password")) {
    throw new BadRequestException("You must specify a password");
  }

  if (!url.searchParams.get("ip")) {
    throw new BadRequestException("You must specify an ip address");
  }
}

/**
 * Parse HTTP Basic Authorization value.
 * @param {Request} request
 * @throws {BadRequestException}
 * @returns {{ user: string, pass: string }}
 */
function basicAuthentication(request) {
  const Authorization = request.headers.get("Authorization");

  const [scheme, encoded] = Authorization.split(" ");

  // Decodes the base64 value and performs unicode normalization.
  // @see https://dev.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
  const buffer = Uint8Array.from(atob(encoded), (character) =>
    character.charCodeAt(0)
  );
  const decoded = new TextDecoder().decode(buffer).normalize();

  // The username & password are split by the first colon.
  //=> example: "username:password"
  const index = decoded.indexOf(":");

  // The user & password are split by the first colon and MUST NOT contain control characters.
  // @see https://tools.ietf.org/html/rfc5234#appendix-B.1 (=> "CTL = %x00-1F / %x7F")
  if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) {
    throw new BadRequestException("Invalid authorization value.");
  }

  return {
    username: decoded.substring(0, index),
    password: decoded.substring(index + 1),
  };
}

class UnauthorizedException {
  constructor(reason) {
    this.status = 401;
    this.statusText = "Unauthorized";
    this.reason = reason;
  }
}

class BadRequestException {
  constructor(reason) {
    this.status = 400;
    this.statusText = "Bad Request";
    this.reason = reason;
  }
}

class Cloudflare {
  constructor(options) {
    this.cloudflare_url = "https://api.cloudflare.com/client/v4";

    if (options.token) {
      this.token = options.token;
    }

    this.findZone = async (name) => {
      var response = await fetch(
        `https://api.cloudflare.com/client/v4/zones?name=${name}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
        }
      );
      var body = await response.json();
      return body.result[0];
    };

    this.findRecord = async (zone, name) => {
      var response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?name=${name}`,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
        }
      );
      var body = await response.json();
      return body.result[0];
    };

    this.updateRecord = async (record, value) => {
      record.content = value;
      var response = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${record.zone_id}/dns_records/${record.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify(record),
        }
      );
      var body = await response.json();
      return body.result[0];
    };
  }
}

addEventListener("fetch", (event) => {
  event.respondWith(
    handleRequest(event.request).catch((err) => {
      const message = err.reason || err.stack || "Unknown Error";

      return new Response(message, {
        status: err.status || 500,
        statusText: err.statusText || null,
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
          // Disables caching by default.
          "Cache-Control": "no-store",
          // Returns the "Content-Length" header for HTTP HEAD requests.
          "Content-Length": message.length,
        },
      });
    })
  );
});