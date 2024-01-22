import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

function ScrollToTop() {
  const { pathname } = useLocation();

  const scrollToTop = () => {
    const c = document.documentElement.scrollTop || document.body.scrollTop;
    if (c > 0) {
      window.requestAnimationFrame(scrollToTop);
      window.scrollTo(0, c - c / 8);
      // You can adjust the division value for smoother or faster scroll
    }
  };

  useEffect(() => {
    scrollToTop();
  }, [pathname]);

  return null;
}

export default ScrollToTop;
