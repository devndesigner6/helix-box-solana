module.exports = function nativeX402Paywall({ types: t }) {
  return {
    visitor: {
      CallExpression(path, state) {
        const platform = state.file.opts.caller?.platform;
        if (platform !== 'android' && platform !== 'ios') return;
        if (path.node.callee.type !== 'Import') return;
        const target = path.get('arguments.0').evaluate();
        if (!target.confident || target.value !== '@x402/paywall') return;
        // The native client uses wallet signing, never the server's optional browser checkout.
        path.replaceWith(t.callExpression(
          t.memberExpression(t.identifier('Promise'), t.identifier('reject')),
          [t.newExpression(t.identifier('Error'), [t.stringLiteral('Browser paywalls are unavailable in the native client')])],
        ));
      },
    },
  };
};
