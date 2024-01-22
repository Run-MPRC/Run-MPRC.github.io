import React, { useContext, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import parse from 'html-react-parser';
import ServiceLocatorContext from '../services/ServiceLocatorContext';

function MembersOnly({ dataKey, style }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const { firebaseResources } = useContext(ServiceLocatorContext);

  const documentId = 'x2ot5EAuuTvW02ZzkmEO'; // Your document ID

  useEffect(() => {
    if (!firebaseResources) {
      // If firebaseResources is not available, don't proceed.
      console.log('Firebase resources not available yet.');
      return;
    }

    const db = firebaseResources.firestore;
    const fetchData = async () => {
      const docRef = doc(db, 'members_only', documentId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const map = docSnap.data();
        setData(map[dataKey]);
      } else {
        console.log('No such document!');
      }
      setLoading(false);
    };

    fetchData();
  }, [firebaseResources]); // Added firebaseResources as a dependency

  if (loading) {
    return <p>Loading...</p>;
  }

  return <div style={style}>{data && parse(data)}</div>;
}

export default MembersOnly;
