const createMockRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    type(value) {
      this.contentType = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    render(view, payload) {
      this.view = view;
      this.body = payload;
      return this;
    },
  };

  return res;
};

module.exports = {
  createMockRes,
};
