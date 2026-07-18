import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { backendClient } from '../../api/backendClient';
import { Pet, StudentPet, PetFood, PetTip, PET_LEVELS, PET_STAGE_NAMES, getPetLevelConfig, getCumulativeThresholdForLevel, calculatePetLevel } from '../../types';
import { useAuth } from '../../hooks/useAuth';
import { usePoints } from '../../hooks/usePoints';
import { EvolutionEffect } from './game/EvolutionEffect';

export const PetModule: React.FC = () => {
  const [pets, setPets] = useState<Pet[]>([]);
  const [studentPet, setStudentPet] = useState<StudentPet | null>(null);
  const [petDetails, setPetDetails] = useState<Pet | null>(null);
  const [foods, setFoods] = useState<PetFood[]>([]);
  const [tips, setTips] = useState<PetTip[]>([]);
  const [currentTip, setCurrentTip] = useState<string>('');
  const [showTip, setShowTip] = useState(false);
  const [isEating, setIsEating] = useState(false);
  const [showEvolution, setShowEvolution] = useState(false);
  const [evolvedLevel, setEvolvedLevel] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showChangePetModal, setShowChangePetModal] = useState(false);
  const [showFormSelectModal, setShowFormSelectModal] = useState(false);
  const [showChangeConfirmModal, setShowChangeConfirmModal] = useState(false);
  const [selectedPetToChange, setSelectedPetToChange] = useState<Pet | null>(null);
  const [petChangeThreshold, setPetChangeThreshold] = useState(100);
  const [levelConfig, setLevelConfig] = useState({ baseThreshold: 50, increment: 50, maxStage: 5 });
  const { profile, refreshProfile } = useAuth();
  const { updatePoints } = usePoints();

  useEffect(() => {
    if (profile) {
      fetchData();
      fetchPetThresholds();
    }
  }, [profile]);

  useEffect(() => {
    if (studentPet && tips.length > 0) {
      const interval = setInterval(() => {
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        setCurrentTip(randomTip.content);
        setShowTip(true);
        setTimeout(() => setShowTip(false), 5000);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [studentPet, tips]);

  const fetchData = async () => {
    if (!profile) return;

    try {
      const [{ data: petsData }, { data: studentPetData }, { data: foodsData }, { data: tipsData }, { data: configData }] = await Promise.all([
        backendClient.from('pets').select('*'),
        backendClient.from('student_pets').select('*').eq('student_id', profile.id).maybeSingle(),
        backendClient.from('pet_foods').select('*').eq('is_active', true),
        backendClient.from('pet_tips').select('*'),
        backendClient.from('pet_config').select('*').maybeSingle(),
      ]);

      if (configData) {
        setLevelConfig({
          baseThreshold: configData.level_base_threshold || 50,
          increment: configData.level_threshold_increment || 50,
          maxStage: configData.max_stage || 5,
        });
      }

      if (petsData) setPets(petsData as Pet[]);
      if (studentPetData) {
        setStudentPet(studentPetData as StudentPet);
        const { data: petData } = await backendClient
          .from('pets')
          .select('*')
          .eq('id', studentPetData.pet_id)
          .maybeSingle();
        if (petData) setPetDetails(petData as Pet);
      } else if (petsData && petsData.length > 0) {
        const randomPet = petsData[Math.floor(Math.random() * petsData.length)];
        await backendClient.from('student_pets').insert({
          student_id: profile.id,
          pet_id: randomPet.id,
          growth_level: 1,
          growth_value: 0,
        });
        setStudentPet({
          id: '',
          student_id: profile.id,
          pet_id: randomPet.id,
          growth_level: 1,
          growth_value: 0,
        } as StudentPet);
        setPetDetails(randomPet as Pet);
      }
      if (foodsData) setFoods(foodsData as PetFood[]);
      if (tipsData) setTips(tipsData as PetTip[]);
    } catch (err) {
      console.error('萌宠数据加载失败:', err);
    }

    setLoading(false);
  };

  const getPetImage = () => {
    if (!petDetails || !studentPet) return null;
    const displayLevel = studentPet.display_level || studentPet.growth_level || 1;
    const stage = Math.min(displayLevel, levelConfig.maxStage);
    switch (stage) {
      case 1: return petDetails.image_level_1;
      case 2: return petDetails.image_level_2;
      case 3: return petDetails.image_level_3;
      case 4: return petDetails.image_level_4;
      case 5: return petDetails.image_level_5;
      default: return petDetails.image_level_1;
    }
  };

  const getFormImage = (level: number) => {
    if (!petDetails) return null;
    switch (level) {
      case 1: return petDetails.image_level_1;
      case 2: return petDetails.image_level_2;
      case 3: return petDetails.image_level_3;
      case 4: return petDetails.image_level_4;
      case 5: return petDetails.image_level_5;
      default: return petDetails.image_level_1;
    }
  };

  const fetchPetThresholds = async () => {
    const { data } = await backendClient.from('system_config').select('*');
    if (data) {
      const changeConfig = data.find((item: any) => (item.key || item.config_key) === 'pet_change_threshold');
      
      if (changeConfig) {
        let value = changeConfig.value;
        if (typeof changeConfig.value === 'string') {
          try {
            value = JSON.parse(changeConfig.value);
          } catch {}
        }
        const finalValue = typeof value === 'object' && value !== null ? value.value : value;
        setPetChangeThreshold(parseInt(finalValue) || 100);
      }
    }
  };

  const handleSelectForm = async (level: number) => {
    if (!studentPet) return;
    await backendClient.from('student_pets').update({ display_level: level }).eq('id', studentPet.id);
    setShowFormSelectModal(false);
    fetchData();
  };

  const handleAdopt = async (pet: Pet) => {
    if (!profile) return;

    const isChanging = !!studentPet;

    if (isChanging) {
      if ((profile.current_points || 0) < petChangeThreshold) {
        alert(`积分不足!换养宠物需要${petChangeThreshold}积分`);
        return;
      }
      setSelectedPetToChange(pet);
      setShowChangePetModal(false);
      setShowChangeConfirmModal(true);
      return;
    }

    const currentPet = studentPet as unknown as StudentPet | null;
    const currentGrowthLevel = currentPet?.growth_level || 1;
    const currentGrowthValue = currentPet?.growth_value || 0;

    if (currentPet) {
      await backendClient.from('student_pets').delete().eq('id', currentPet.id);
    }

    await backendClient.from('student_pets').insert({
      student_id: profile.id,
      pet_id: pet.id,
      growth_level: currentGrowthLevel,
      growth_value: currentGrowthValue,
    });

    setShowAdoptModal(false);
    setShowChangePetModal(false);
    fetchData();
  };

  const confirmChangePet = async () => {
    if (!profile || !selectedPetToChange) return;

    const currentGrowthLevel = studentPet?.growth_level || 1;
    const currentGrowthValue = studentPet?.growth_value || 0;

    await updatePoints(profile.id, -petChangeThreshold);

    if (studentPet) {
      await backendClient.from('student_pets').delete().eq('id', studentPet.id);
    }

    await backendClient.from('student_pets').insert({
      student_id: profile.id,
      pet_id: selectedPetToChange.id,
      growth_level: currentGrowthLevel,
      growth_value: currentGrowthValue,
    });

    alert(`换养成功!已扣除${petChangeThreshold}积分，${selectedPetToChange.name}继承了之前的成长等级和成长值`);

    setShowChangeConfirmModal(false);
    setSelectedPetToChange(null);
    fetchData();
  };

  const handleFeed = async (food: PetFood) => {
    if (!profile || !studentPet || isEating) return;

    if ((profile.current_points || 0) < (food.points_cost || 0)) {
      alert('积分不足!');
      return;
    }

    setIsEating(true);
    
    try {
      // 使用新的业务API进行喂食（包含事务处理）
      const result = await backendClient.businessFeedPet({
        student_id: profile.id,
        pet_id: studentPet.pet_id,
        food_id: food.id,
        food_amount: 1,
      });
      
      if (result.error) {
        alert(result.error || '喂食失败，请重试');
        return;
      }
      
      // 更新本地用户信息
      if (result.data?.student) {
        refreshProfile();
      }

      // 检查是否升级
      if (result.data?.level_up) {
        const newLevel = result.data.pet?.growth_level || studentPet.growth_level + 1;
        const newStage = Math.min(newLevel, levelConfig.maxStage);
        const oldStage = Math.min(studentPet.growth_level || 1, levelConfig.maxStage);
        // 只有阶段（形态）变化时才触发进化动画
        if (newStage > oldStage) {
          setEvolvedLevel(newStage);
          setShowEvolution(true);
          setTimeout(() => {
            setShowEvolution(false);
            setIsEating(false);
            fetchData();
          }, 3500);
        } else {
          setTimeout(() => {
            setIsEating(false);
            fetchData();
          }, 2000);
        }
      } else {
        setTimeout(() => {
          setIsEating(false);
          fetchData();
        }, 2000);
      }
    } catch (apiError: any) {
      // 如果API调用失败，降级使用原方法
      console.warn('业务API调用失败，降级使用原始方法:', apiError);
      await updatePoints(profile.id, -(food.points_cost || 0));

      const newGrowth = (studentPet.growth_value || 0) + (food.growth_value || 0);
      const newLevel = calculatePetLevel(newGrowth, levelConfig.baseThreshold, levelConfig.increment);

      await backendClient
        .from('student_pets')
        .update({ growth_value: newGrowth, growth_level: newLevel })
        .eq('id', studentPet.id);

      const newStage = Math.min(newLevel, levelConfig.maxStage);
      const oldStage = Math.min(studentPet.growth_level || 1, levelConfig.maxStage);
      // 只有阶段（形态）变化时才触发进化动画
      if (newStage > oldStage) {
        setEvolvedLevel(newStage);
        setShowEvolution(true);
        setTimeout(() => {
          setShowEvolution(false);
          setIsEating(false);
          refreshProfile();
          fetchData();
        }, 3500);
      } else {
        setTimeout(() => {
          setIsEating(false);
          refreshProfile();
          fetchData();
        }, 2000);
      }
    }
  };

  const currentLevel = studentPet?.growth_level || 1;
  const currentStage = Math.min(currentLevel, levelConfig.maxStage);
  const stageName = PET_STAGE_NAMES[currentStage - 1] || `阶段${currentStage}`;

  // 计算当前等级的进度
  const currentLevelMinGrowth = getCumulativeThresholdForLevel(currentLevel, levelConfig.baseThreshold, levelConfig.increment);
  const nextLevelMinGrowth = getCumulativeThresholdForLevel(currentLevel + 1, levelConfig.baseThreshold, levelConfig.increment);
  const currentGrowth = studentPet?.growth_value || 0;
  const progress = nextLevelMinGrowth > currentLevelMinGrowth
    ? Math.min(100, Math.max(0, (currentGrowth - currentLevelMinGrowth) / (nextLevelMinGrowth - currentLevelMinGrowth) * 100))
    : 0;

  const petImage = getPetImage();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fa-solid fa-circle-notch fa-spin text-3xl text-blue-500"></i>
      </div>
    );
  }

  if (!studentPet) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <div className="w-24 h-24 bg-gray-200 rounded-full mx-auto mb-6 flex items-center justify-center">
            <i className="fa-solid fa-paw text-gray-400 text-4xl"></i>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">暂无萌宠</h2>
          <p className="text-gray-500 mb-6">系统中还没有可用的萌宠，请联系管理员添加</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <EvolutionEffect
        show={showEvolution}
        level={evolvedLevel}
        petImageUrl={petImage}
        petName={petDetails?.name || '萌宠'}
        onComplete={() => setShowEvolution(false)}
      />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <div className="bg-gradient-to-br from-blue-100 to-purple-100 rounded-2xl p-6 h-[400px] relative overflow-hidden flex items-center justify-center">
            <motion.div
              className="relative"
              animate={{
                scale: isEating ? [1, 1.1, 1] : 1,
                y: isEating ? [0, -10, 0] : [0, -5, 0],
              }}
              transition={{
                scale: { duration: 0.3 },
                y: { repeat: Infinity, duration: 2, ease: 'easeInOut' },
              }}
            >
              {petImage ? (
                <img
                  src={petImage}
                  alt={petDetails?.name}
                  className="w-48 h-48 object-contain"
                />
              ) : (
                <div className="w-48 h-48 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full flex items-center justify-center">
                  <i className="fa-solid fa-paw text-white text-6xl"></i>
                </div>
              )}
            </motion.div>

            <AnimatePresence>
              {showTip && (
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.8 }}
                  className="absolute top-4 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-lg p-4 max-w-xs"
                >
                  <div className="flex items-start gap-2">
                    <i className="fa-solid fa-lightbulb text-yellow-500 mt-1"></i>
                    <p className="text-sm text-gray-700">{currentTip}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute bottom-4 left-4 right-4">
              <div className="bg-white/90 backdrop-blur rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-800">{petDetails?.name}</span>
                  <span className="text-sm text-purple-600">Lv.{currentLevel} {stageName}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="bg-gradient-to-r from-pink-500 to-purple-500 h-3 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 mt-1 text-center">
                  成长值: {studentPet?.growth_value || 0} / {nextLevelMinGrowth}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-utensils text-orange-500"></i>
                喂食
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowFormSelectModal(true)}
                  className="text-xs px-2 py-1 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  <i className="fa-solid fa-magic mr-1"></i>
                  形态
                </button>
                <button
                  onClick={() => setShowChangePetModal(true)}
                  disabled={(profile?.current_points || 0) < petChangeThreshold}
                  className={(profile?.current_points || 0) < petChangeThreshold 
                    ? 'text-xs px-2 py-1 rounded-lg transition-colors bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'text-xs px-2 py-1 rounded-lg transition-colors bg-pink-100 text-pink-600 hover:bg-pink-200'
                  }
                >
                  <i className="fa-solid fa-exchange-alt mr-1"></i>
                  换养
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {foods.map((food) => (
                <button
                  key={food.id}
                  onClick={() => handleFeed(food)}
                  disabled={isEating || (profile?.current_points || 0) < (food.points_cost || 0)}
                  className="w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                      <i className="fa-solid fa-bone text-orange-500"></i>
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{food.name}</p>
                      <p className="text-xs text-gray-500">+{food.growth_value} 成长值</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-yellow-600">
                    <i className="fa-solid fa-coins mr-1"></i>
                    {food.points_cost}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-chart-line text-blue-500"></i>
              成长阶段
            </h3>
            <div className="space-y-2">
              {getPetLevelConfig(levelConfig.baseThreshold, levelConfig.increment, levelConfig.maxStage).map((level) => {
                const isCurrentStage = level.level === currentStage;
                const isUnlocked = level.level <= currentStage;
                const divClass = isCurrentStage ? 'flex items-center gap-3 p-2 rounded-lg bg-blue-50 border border-blue-200' : 'flex items-center gap-3 p-2 rounded-lg';
                const badgeClass = isUnlocked ? 'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-gradient-to-br from-pink-400 to-purple-400 text-white' : 'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-gray-200 text-gray-400';
                const nameClass = isUnlocked ? 'font-medium text-gray-800' : 'font-medium text-gray-400';
                return (
                  <div key={level.level} className={divClass}>
                    <div className={badgeClass}>
                      {level.level}
                    </div>
                    <div className="flex-1">
                      <p className={nameClass}>
                        {level.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {level.minGrowth} - {level.maxGrowth} 成长值
                      </p>
                    </div>
                    {isCurrentStage && (
                      <i className="fa-solid fa-star text-yellow-500"></i>
                    )}
                  </div>
                );
              })}
              {currentLevel > levelConfig.maxStage && (
                <div className="flex items-center gap-3 p-2 rounded-lg bg-purple-50 border border-purple-200">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-gradient-to-br from-purple-500 to-indigo-500 text-white">
                    <i className="fa-solid fa-infinity"></i>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-purple-800">
                      超越阶段 (Lv.{currentLevel})
                    </p>
                    <p className="text-xs text-gray-500">
                      当前累计 {studentPet?.growth_value || 0} 成长值
                    </p>
                  </div>
                  <i className="fa-solid fa-crown text-yellow-500"></i>
                </div>
              )}
            </div>
          </div>

          <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
            <h3 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
              <i className="fa-solid fa-circle-info text-amber-600"></i>
              宠物小贴士
            </h3>
            <div className="space-y-2 text-sm text-amber-700">
              <div className="flex items-start gap-2">
                <i className="fa-solid fa-bolt text-amber-500 mt-0.5"></i>
                <p>宠物等级影响<strong>战力倍率</strong>，等级越高战力越强</p>
              </div>
              <div className="flex items-start gap-2">
                <i className="fa-solid fa-coins text-amber-500 mt-0.5"></i>
                <p>战力倍率越高，做题获得的<strong>积分越多</strong>（积分 = 基础分 x 战力倍率）</p>
              </div>
              <div className="flex items-start gap-2">
                <i className="fa-solid fa-infinity text-amber-500 mt-0.5"></i>
                <p>宠物等级<strong>可以无限升级</strong>，没有上限，养成永无止境！</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showChangePetModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowChangePetModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-8 max-w-2xl w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-gray-800 mb-2 text-center">换养萌宠</h3>
              <p className="text-sm text-gray-500 text-center mb-6">
                当前成长等级和成长值会保留到新萌宠
              </p>
              <p className="text-center mb-4 text-sm text-gray-600">
                <i className="fa-solid fa-coins mr-1"></i>
                换养需要 <span className="font-bold text-pink-600">{petChangeThreshold}</span> 积分
                <br />
                当前积分: <span className={"font-bold " + ((profile?.current_points || 0) >= petChangeThreshold ? 'text-green-600' : 'text-red-600')}>{profile?.current_points || 0}</span>
              </p>
              <div className="grid grid-cols-2 gap-4">
                {pets.filter((p) => p.id !== petDetails?.id).map((pet) => {
                  const isDisabled = (profile?.current_points || 0) < petChangeThreshold;
                  return (
                    <button
                      key={pet.id}
                      onClick={() => handleAdopt(pet)}
                      disabled={isDisabled}
                      className={isDisabled 
                        ? 'p-6 rounded-xl transition-all border-2 border-transparent bg-gray-100 opacity-50 cursor-not-allowed'
                        : 'p-6 rounded-xl transition-all border-2 border-transparent bg-gradient-to-br from-pink-50 to-purple-50 hover:shadow-lg hover:border-pink-300'
                      }
                    >
                      <div className="w-16 h-16 bg-gradient-to-br from-pink-400 to-purple-400 rounded-full mx-auto mb-3 flex items-center justify-center overflow-hidden">
                        {pet.image_level_1 ? (
                          <img src={pet.image_level_1} alt={pet.name} className="w-full h-full object-contain" />
                        ) : (
                          <i className="fa-solid fa-paw text-white text-2xl"></i>
                        )}
                      </div>
                      <p className="font-bold text-gray-800">{pet.name}</p>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFormSelectModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowFormSelectModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-8 max-w-3xl w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-gray-800 mb-2 text-center">选择形态</h3>
              <p className="text-sm text-gray-500 text-center mb-6">
                选择已解锁的形态作为桌面宠物形象 (当前: 等级{studentPet.display_level || studentPet.growth_level})
              </p>
              <div className="grid grid-cols-5 gap-4">
                {PET_LEVELS.map((level) => {
                  const isUnlocked = level.level <= (studentPet.growth_level || 1);
                  const isSelected = (studentPet.display_level || studentPet.growth_level) === level.level;
                  const formImage = getFormImage(level.level);
                  const buttonClass = isUnlocked 
                    ? (isSelected 
                        ? 'p-4 rounded-xl transition-all bg-gradient-to-br from-pink-100 to-purple-100 border-2 border-pink-400 shadow-lg'
                        : 'p-4 rounded-xl transition-all bg-gray-50 hover:bg-gray-100 border-2 border-transparent hover:border-pink-200')
                    : 'p-4 rounded-xl transition-all bg-gray-100 opacity-50 cursor-not-allowed';
                  const iconBgClass = isUnlocked ? 'bg-gradient-to-br from-pink-400 to-purple-400' : 'bg-gray-300';
                  const textClass = isUnlocked ? 'text-gray-800' : 'text-gray-400';
                  return (
                    <button
                      key={level.level}
                      onClick={() => isUnlocked && handleSelectForm(level.level)}
                      disabled={!isUnlocked}
                      className={buttonClass}
                    >
                      <div className={"w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center overflow-hidden " + iconBgClass}>
                        {formImage && isUnlocked ? (
                          <img src={formImage} alt={level.name} className="w-full h-full object-contain" />
                        ) : (
                          <i className="fa-solid fa-lock text-white text-xl"></i>
                        )}
                      </div>
                      <p className={"font-bold text-sm " + textClass}>
                        {level.name}
                      </p>
                      <p className="text-xs text-gray-500">Lv.{level.level}</p>
                      {isSelected && (
                        <div className="mt-2 text-xs text-pink-600 font-medium">
                          <i className="fa-solid fa-check mr-1"></i>当前
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showChangeConfirmModal && selectedPetToChange && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowChangeConfirmModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl p-8 max-w-md w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-gray-800 mb-4 text-center">确认换养</h3>
              
              <div className="text-center mb-6">
                <div className="w-24 h-24 bg-gradient-to-br from-pink-400 to-purple-400 rounded-full mx-auto mb-4 flex items-center justify-center overflow-hidden">
                  {selectedPetToChange.image_level_1 ? (
                    <img src={selectedPetToChange.image_level_1} alt={selectedPetToChange.name} className="w-full h-full object-contain" />
                  ) : (
                    <i className="fa-solid fa-paw text-white text-4xl"></i>
                  )}
                </div>
                <p className="text-lg font-bold text-gray-800 mb-2">{selectedPetToChange.name}</p>
                <p className="text-sm text-gray-600">
                  换养将扣除 <span className="font-bold text-pink-600">{petChangeThreshold}</span> 积分
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  当前成长等级和成长值会保留到新萌宠
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowChangeConfirmModal(false);
                    setSelectedPetToChange(null);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={confirmChangePet}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-lg hover:from-pink-600 hover:to-purple-600 transition-all"
                >
                  确认换养
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
