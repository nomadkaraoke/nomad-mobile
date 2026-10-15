/* global jest */
// FlashList 2.0.2's bundled jestSetup swaps in a non-existent `RecyclerView` export, so only take its
// layout-measurement mock: gives the real FlashList a 400x900 viewport so items render under jest.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const box = (width, height) => jest.fn(() => ({ x: 0, y: 0, width, height }));
  return {
    ...actual,
    measureParentSize: box(400, 900),
    measureFirstChildLayout: box(400, 900),
    measureItemLayout: box(100, 100),
  };
});

// Skia's official mock needs canvaskit-wasm + a custom env; a structural mock is enough for our wrappers.
jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Passthrough = ({ children }) => React.createElement(React.Fragment, null, children);
  return {
    Canvas: ({ children, style }) => React.createElement(View, { style, testID: 'skia-canvas' }, children),
    Group: Passthrough,
    Rect: (props) => React.createElement(View, { testID: 'skia-rect', ...props }),
  };
});
