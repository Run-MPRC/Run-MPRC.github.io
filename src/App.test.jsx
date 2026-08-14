/* eslint-env jest */

import React from 'react';
import PropTypes from 'prop-types';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  Link,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import App from './App';
import ScrollToTop from './components/ScrollToTop';

jest.mock('./services/ServiceLocatorProvider', () => function TestServiceLocatorProvider({
  children,
}) {
  return children;
});

jest.mock('./services/ServiceLocatorContext', () => ({
  useServiceLocator: () => ({ services: null, isReady: false }),
}));

jest.mock('./services/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    isAuthenticated: false,
    isMember: false,
    isAdmin: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    register: jest.fn(),
  }),
}));

test('renders the MPRC home route without contacting Firebase', () => {
  render(<App />);
  expect(screen.getByRole('heading', {
    level: 1,
    name: /mid-peninsula running club/i,
  })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
    'href',
    '#main-content',
  );
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
});

const ROUTE_FOCUS_FUTURE_FLAGS = Object.freeze({
  v7_relativeSplatPath: true,
  v7_startTransition: true,
});

function DestinationFocus({ mode }) {
  const targetRef = React.useRef(null);

  React.useLayoutEffect(() => {
    if (mode === 'layout') targetRef.current?.focus();
  }, [mode]);

  React.useEffect(() => {
    if (mode === 'passive') targetRef.current?.focus();
  }, [mode]);

  return <button type="button" ref={targetRef}>Destination focus</button>;
}

DestinationFocus.propTypes = {
  mode: PropTypes.oneOf([null, 'layout', 'passive']),
};

function RouteFocusHarness({
  destinationFocus = null,
  mainKey = 'current-main',
  showMain = true,
  showOutsideFocus = true,
}) {
  const navigate = useNavigate();

  return (
    <>
      <Link to="/destination">Persistent navigation</Link>
      <Link to="/destination?view=full#summary">Path with search and hash</Link>
      <Link to="/middle">Middle navigation</Link>
      <Link to="/redirect">Redirect navigation</Link>
      <button type="button" onClick={() => navigate('/destination')}>
        Programmatic destination
      </button>
      <button type="button" onClick={() => navigate('/?filter=one')}>
        Change search
      </button>
      <button type="button" onClick={() => navigate('/#details')}>
        Change hash
      </button>
      <button type="button" onClick={() => navigate('/', { state: { synthetic: true } })}>
        Change state
      </button>
      <button type="button" onClick={() => navigate('/', { replace: true })}>
        Replace same path
      </button>
      <button type="button" onClick={() => navigate(-1)}>Back navigation</button>
      <button type="button" onClick={() => navigate(1)}>Forward navigation</button>
      {showOutsideFocus && <button type="button">Persistent outside focus</button>}
      <ScrollToTop />
      {showMain && (
        <main id="main-content" key={mainKey} tabIndex={-1}>
          <button type="button">Persistent main control</button>
          <Routes>
            <Route
              path="/"
              element={(
                <>
                  <h1>Origin page</h1>
                  <button type="button">Outgoing route control</button>
                </>
              )}
            />
            <Route path="/middle" element={<h1>Middle page</h1>} />
            <Route path="/redirect" element={<Navigate to="/destination" replace />} />
            <Route
              path="/destination"
              element={(
                <>
                  <h1>Destination page</h1>
                  <DestinationFocus mode={destinationFocus} />
                </>
              )}
            />
          </Routes>
        </main>
      )}
    </>
  );
}

RouteFocusHarness.propTypes = {
  destinationFocus: PropTypes.oneOf([null, 'layout', 'passive']),
  mainKey: PropTypes.string,
  showMain: PropTypes.bool,
  showOutsideFocus: PropTypes.bool,
};

function PassiveDestinationBeforeScrollHarness() {
  return (
    <>
      <Link to="/destination">Passive-focus navigation</Link>
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<h1>Passive origin</h1>} />
          <Route
            path="/destination"
            element={(
              <>
                <h1>Passive destination</h1>
                <DestinationFocus mode="passive" />
              </>
            )}
          />
        </Routes>
      </main>
      <ScrollToTop />
    </>
  );
}

function routeFocusTree({
  destinationFocus = null,
  initialEntries = ['/'],
  initialIndex,
  mainKey = 'current-main',
  showMain = true,
  showOutsideFocus = true,
  strict = false,
} = {}) {
  const tree = (
    <MemoryRouter
      future={ROUTE_FOCUS_FUTURE_FLAGS}
      initialEntries={initialEntries}
      initialIndex={initialIndex}
    >
      <RouteFocusHarness
        destinationFocus={destinationFocus}
        mainKey={mainKey}
        showMain={showMain}
        showOutsideFocus={showOutsideFocus}
      />
    </MemoryRouter>
  );
  return strict ? <React.StrictMode>{tree}</React.StrictMode> : tree;
}

describe('WEB-UX-004 SPA route focus handoff', () => {
  let allFrames;
  let nextFrameId;
  let pendingFrames;

  beforeEach(() => {
    allFrames = new Map();
    nextFrameId = 0;
    pendingFrames = new Map();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrameId += 1;
      allFrames.set(nextFrameId, callback);
      pendingFrames.set(nextFrameId, callback);
      return nextFrameId;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((frameId) => {
      pendingFrames.delete(frameId);
    });
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function invokeFrame(frameId) {
    const callback = allFrames.get(frameId);
    expect(callback).toEqual(expect.any(Function));
    pendingFrames.delete(frameId);
    act(() => callback(16));
  }

  function invokeOnlyPendingFrame() {
    expect(pendingFrames.size).toBe(1);
    invokeFrame([...pendingFrames.keys()][0]);
  }

  test('keeps initial and deep-link rendering focus-inert while preserving scroll', () => {
    const initial = render(routeFocusTree());
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).not.toHaveFocus();

    initial.unmount();
    render(routeFocusTree({ initialEntries: ['/destination?view=full#summary'] }));
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).not.toHaveFocus();
  });

  test('ignores search, hash, state, and same-path replacement changes', () => {
    render(routeFocusTree());

    ['Change search', 'Change hash', 'Change state', 'Replace same path'].forEach((name) => {
      fireEvent.click(screen.getByRole('button', { name }));
    });

    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).not.toHaveFocus();
  });

  test('moves an unchanged persistent navigation origin to main exactly once', () => {
    render(routeFocusTree());
    const main = screen.getByRole('main');
    const mainFocus = jest.spyOn(main, 'focus');
    const navigation = screen.getByRole('link', { name: 'Persistent navigation' });
    navigation.focus();

    fireEvent.click(navigation);
    expect(screen.getByRole('heading', { name: 'Destination page' }))
      .toBeInTheDocument();
    const frameId = [...pendingFrames.keys()][0];
    invokeFrame(frameId);

    expect(main).toHaveFocus();
    expect(mainFocus).toHaveBeenCalledTimes(1);
    expect(mainFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    invokeFrame(frameId);
    expect(mainFocus).toHaveBeenCalledTimes(1);
  });

  test('restores body, document-root, null, and disconnected focus fallbacks to main', () => {
    render(routeFocusTree());
    const main = screen.getByRole('main');

    const navigateAndSetActive = (active) => {
      const middle = screen.getByRole('link', { name: 'Middle navigation' });
      middle.focus();
      fireEvent.click(middle);
      const activeSpy = jest.spyOn(document, 'activeElement', 'get').mockReturnValue(active);
      invokeOnlyPendingFrame();
      activeSpy.mockRestore();
      expect(main).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Back navigation' }));
      invokeOnlyPendingFrame();
      expect(main).toHaveFocus();
    };

    navigateAndSetActive(document.body);
    navigateAndSetActive(document.documentElement);
    navigateAndSetActive(null);
    navigateAndSetActive(document.createElement('button'));
  });

  test('recovers after the focused outgoing route control is disconnected', () => {
    render(routeFocusTree());
    const outgoing = screen.getByRole('button', { name: 'Outgoing route control' });
    outgoing.focus();

    fireEvent.click(screen.getByRole('button', { name: 'Programmatic destination' }));
    expect(outgoing.isConnected).toBe(false);
    invokeOnlyPendingFrame();

    expect(screen.getByRole('main')).toHaveFocus();
  });

  test('does not refocus main or replace its connected descendant focus', () => {
    render(routeFocusTree());
    const main = screen.getByRole('main');
    const mainFocus = jest.spyOn(main, 'focus');
    main.focus();
    mainFocus.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Programmatic destination' }));
    invokeOnlyPendingFrame();
    expect(main).toHaveFocus();
    expect(mainFocus).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back navigation' }));
    invokeOnlyPendingFrame();
    const descendant = screen.getByRole('button', { name: 'Persistent main control' });
    descendant.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Programmatic destination' }));
    invokeOnlyPendingFrame();
    expect(descendant).toHaveFocus();
    expect(mainFocus).not.toHaveBeenCalled();
  });

  test.each(['layout', 'passive'])(
    'never focuses main when the destination owns %s-effect focus',
    (destinationFocus) => {
      render(routeFocusTree({ destinationFocus }));
      const main = screen.getByRole('main');
      const mainFocus = jest.spyOn(main, 'focus');
      const navigation = screen.getByRole('link', { name: 'Persistent navigation' });
      navigation.focus();

      fireEvent.click(navigation);
      const destination = screen.getByRole('button', { name: 'Destination focus' });
      expect(destination).toHaveFocus();
      expect(mainFocus).not.toHaveBeenCalled();
      invokeOnlyPendingFrame();
      expect(destination).toHaveFocus();
      expect(mainFocus).not.toHaveBeenCalled();
    },
  );

  test('schedules settlement after destination passive focus work', () => {
    window.requestAnimationFrame.mockImplementation((callback) => {
      nextFrameId += 1;
      callback(16);
      return nextFrameId;
    });
    render(
      <MemoryRouter future={ROUTE_FOCUS_FUTURE_FLAGS}>
        <PassiveDestinationBeforeScrollHarness />
      </MemoryRouter>,
    );
    const main = screen.getByRole('main');
    const mainFocus = jest.spyOn(main, 'focus');
    const navigation = screen.getByRole('link', { name: 'Passive-focus navigation' });
    navigation.focus();

    fireEvent.click(navigation);

    expect(screen.getByRole('button', { name: 'Destination focus' })).toHaveFocus();
    expect(mainFocus).not.toHaveBeenCalled();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  test('consumes a deliberate outside-focus handoff without a delayed retry', () => {
    const view = render(routeFocusTree());
    const main = screen.getByRole('main');
    const mainFocus = jest.spyOn(main, 'focus');
    const navigation = screen.getByRole('link', { name: 'Persistent navigation' });
    navigation.focus();
    fireEvent.click(navigation);

    const outside = screen.getByRole('button', { name: 'Persistent outside focus' });
    outside.focus();
    invokeOnlyPendingFrame();
    expect(outside).toHaveFocus();
    expect(mainFocus).not.toHaveBeenCalled();

    view.rerender(routeFocusTree({ showOutsideFocus: false }));
    expect(document.body).toHaveFocus();
    view.rerender(routeFocusTree());
    expect(mainFocus).not.toHaveBeenCalled();
    expect(main).not.toHaveFocus();
  });

  test('generation-fences a canceled intermediate transition', () => {
    render(routeFocusTree());
    const main = screen.getByRole('main');
    const mainFocus = jest.spyOn(main, 'focus');
    const middle = screen.getByRole('link', { name: 'Middle navigation' });
    middle.focus();
    fireEvent.click(middle);
    const middleFrame = [...pendingFrames.keys()][0];

    fireEvent.click(screen.getByRole('link', { name: 'Persistent navigation' }));
    const destinationFrame = [...pendingFrames.keys()][0];
    expect(destinationFrame).not.toBe(middleFrame);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(middleFrame);

    invokeFrame(middleFrame);
    expect(mainFocus).not.toHaveBeenCalled();
    invokeFrame(destinationFrame);
    expect(main).toHaveFocus();
    expect(mainFocus).toHaveBeenCalledTimes(1);
  });

  test('coalesces a synchronous redirect onto the final pathname', async () => {
    render(routeFocusTree());
    const main = screen.getByRole('main');
    const mainFocus = jest.spyOn(main, 'focus');
    const redirect = screen.getByRole('link', { name: 'Redirect navigation' });
    redirect.focus();
    fireEvent.click(redirect);

    expect(await screen.findByRole('heading', { name: 'Destination page' }))
      .toBeInTheDocument();
    expect(allFrames.size).toBeGreaterThanOrEqual(2);
    const frameIds = [...allFrames.keys()];
    frameIds.slice(0, -1).forEach((frameId) => {
      invokeFrame(frameId);
      expect(mainFocus).not.toHaveBeenCalled();
    });
    invokeFrame(frameIds[frameIds.length - 1]);
    expect(main).toHaveFocus();
    expect(mainFocus).toHaveBeenCalledTimes(1);
  });

  test('consumes a replaced main identity without focusing the replacement later', () => {
    const view = render(routeFocusTree());
    const oldMain = screen.getByRole('main');
    const oldFocus = jest.spyOn(oldMain, 'focus');
    fireEvent.click(screen.getByRole('link', { name: 'Persistent navigation' }));
    const frameId = [...pendingFrames.keys()][0];

    view.rerender(routeFocusTree({ mainKey: 'replacement-main' }));
    const replacement = screen.getByRole('main');
    const replacementFocus = jest.spyOn(replacement, 'focus');
    expect(oldMain.isConnected).toBe(false);
    invokeFrame(frameId);

    expect(oldFocus).not.toHaveBeenCalled();
    expect(replacementFocus).not.toHaveBeenCalled();
    view.rerender(routeFocusTree({ mainKey: 'third-main' }));
    expect(screen.getByRole('main')).not.toHaveFocus();
  });

  test('consumes a missing main target without focusing one added later', () => {
    const view = render(routeFocusTree({ showMain: false }));
    const navigation = screen.getByRole('link', { name: 'Persistent navigation' });
    navigation.focus();
    fireEvent.click(navigation);
    invokeOnlyPendingFrame();

    view.rerender(routeFocusTree());
    expect(screen.getByRole('main')).not.toHaveFocus();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  test('cancels and fences a hostile callback after unmount', () => {
    const view = render(routeFocusTree());
    fireEvent.click(screen.getByRole('link', { name: 'Persistent navigation' }));
    const frameId = [...pendingFrames.keys()][0];
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    try {
      view.unmount();
      expect(window.cancelAnimationFrame).toHaveBeenCalledWith(frameId);
      invokeFrame(frameId);
      expect(outside).toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  test('keeps StrictMode initial replay focus-inert', () => {
    render(routeFocusTree({ strict: true }));
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).not.toHaveFocus();
  });

  test('hands off POP backward and forward pathname changes', () => {
    render(routeFocusTree({
      initialEntries: ['/', '/destination'],
      initialIndex: 1,
    }));
    const main = screen.getByRole('main');

    const back = screen.getByRole('button', { name: 'Back navigation' });
    back.focus();
    fireEvent.click(back);
    invokeOnlyPendingFrame();
    expect(main).toHaveFocus();

    const forward = screen.getByRole('button', { name: 'Forward navigation' });
    forward.focus();
    fireEvent.click(forward);
    invokeOnlyPendingFrame();
    expect(main).toHaveFocus();
  });

  test('treats a pathname with search and hash as one new-page handoff', () => {
    render(routeFocusTree());
    const navigation = screen.getByRole('link', { name: 'Path with search and hash' });
    navigation.focus();
    fireEvent.click(navigation);
    invokeOnlyPendingFrame();

    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  test('keeps the real skip-link/mobile-close shell and moves hidden-origin focus to main', () => {
    render(<App />);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('link', { name: /skip to content/i }))
      .toHaveAttribute('href', '#main-content');

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const primaryNavigation = document.getElementById('primary-navigation');
    const shop = within(primaryNavigation).getByRole('link', { name: 'Shop' });
    shop.focus();
    fireEvent.click(shop);
    expect(shop.closest('ul')).toHaveClass('hide__nav');
    expect(pendingFrames.size).toBeGreaterThanOrEqual(1);
    [...pendingFrames.keys()].forEach(invokeFrame);

    expect(main).toHaveFocus();
  });
});
