import React, { useRef, useEffect, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useColors } from '../hooks/useColors';

const ITEM_HEIGHT = 44;
const VISIBLE = 5;
const PADDING = Math.floor(VISIBLE / 2);

interface Props {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

export default function WheelPicker({ items, selectedIndex, onChange }: Props) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: selectedIndex * ITEM_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const idx = Math.round(y / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      onChange(clamped);
      scrollRef.current?.scrollTo({ y: clamped * ITEM_HEIGHT, animated: true });
    },
    [items.length, onChange]
  );

  return (
    <View style={styles.container}>
      <View
        pointerEvents="none"
        style={[
          styles.highlight,
          {
            backgroundColor: colors.accentSoft,
            borderTopColor: colors.accent,
            borderBottomColor: colors.accent,
          },
        ]}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        scrollEventThrottle={16}
        nestedScrollEnabled
      >
        <View style={{ height: ITEM_HEIGHT * PADDING }} />
        {items.map((item, i) => {
          const isSelected = i === selectedIndex;
          return (
            <View key={i} style={styles.item}>
              <Text
                style={[
                  styles.itemText,
                  { color: isSelected ? colors.text : colors.textFaint },
                  isSelected && styles.selectedText,
                ]}
              >
                {item}
              </Text>
            </View>
          );
        })}
        <View style={{ height: ITEM_HEIGHT * PADDING }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: ITEM_HEIGHT * VISIBLE,
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: ITEM_HEIGHT * PADDING,
    left: 4,
    right: 4,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderRadius: 8,
    zIndex: 1,
  },
  item: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemText: {
    fontSize: 16,
  },
  selectedText: {
    fontSize: 19,
    fontWeight: '700',
  },
});
