import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import parse from 'html-react-parser';
import { useServiceLocator } from '../services/ServiceLocatorContext';

function MembersOnly({ dataKey, style }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { services, isReady } = useServiceLocator();

  const documentId = 'x2ot5EAuuTvW02ZzkmEO';

  useEffect(() => {
    if (!isReady || !services) {
      return;
    }

    const db = services.firebaseResources.firestore;
    const fetchData = async () => {
      try {
        const docRef = doc(db, 'members_only', documentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const map = docSnap.data();
          setData(map[dataKey] || []);
        } else {
          setError('Document not found');
        }
      } catch (err) {
        setError('Failed to fetch data');
        console.error('Error fetching members-only data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [services, isReady, dataKey]);

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  if (error) {
    return (
      <div className="error">
        Error:
        {error}
      </div>
    );
  }

  return <div style={style}>{data && parse(data)}</div>;
}

export default MembersOnly;
