import { useState } from "react";
// import { Link, NavLink } from "react-router-dom";
import React from "react";
import { links } from "../data";
import { FaBars } from "react-icons/fa";
import { MdOutlineClose } from "react-icons/md";
import "./navbar.css";
import Logo from "../images/navbar/mprc_logo.png";
import { Link } from "react-scroll";

const Navbar = () => {
  const [isNavShowing, setIsNavShowing] = useState(false);

  const handleNavToggle = () => {
    return setIsNavShowing((prevVAlue) => {
      return !prevVAlue;
    });
  };

  return (
    <nav>
      <div className="container nav__container">
        <Link
          className="logo"
          to={"home"}
          spy={true}
          smooth={true}
          offset={-70} // Adjust this offset if needed to correctly position the section
          duration={500}
          onClick={handleNavToggle}
        >
          
          <img src={Logo} alt="Nav-logo" />
        </Link>
        <ul
          className={`nav__links ${isNavShowing ? "show__nav" : "hide__nav"}`}
        >
          {/* Destructure the links array of object from the links to get each item */}
          {links.map(({ name, path, id }, index) => {
            return (
              <li key={index}>
                <Link
                  to={id}
                  spy={true}
                  smooth={true}
                  offset={-70} // Adjust this offset if needed to correctly position the section
                  duration={500}
                  onClick={handleNavToggle}
                >
                  {name}
                </Link>
              </li>
            );
          })}
        </ul>
        <button onClick={handleNavToggle} className="nav__toggle-btn">
          {isNavShowing ? <MdOutlineClose /> : <FaBars />}
        </button>
      </div>
    </nav>
  );
};

export default Navbar;

// export PATH=$PATH:/home/daveworld/bin
